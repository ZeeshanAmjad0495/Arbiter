import type { z } from 'zod';
import type { ArbiterConfig } from '@arbiter/config';
import {
  Artifact,
  type ArtifactStatus,
  AuditEvent,
  type AuditAction,
  type Clock,
  type ContextPack,
  type GroundingReport,
  type GuardrailOutcome,
  type ProjectId,
  type ReviewDecision,
  type ReviewRecord,
  type RiskTier,
  type UserId,
  type WorkflowRunId,
  newArtifactId,
  newAuditEventId,
  newWorkflowRunId,
  nowIso,
  systemClock,
} from '@arbiter/core';
import type { RepositoryBundle } from '@arbiter/db';
import type { LlmProvider, ModelTier } from '@arbiter/llm';
import type { SanitizePort } from '@arbiter/sanitize';
import { ArbiterAttr, GenAI, type Tracer, withSpan } from '@arbiter/telemetry';
import { buildContextPack } from './context';
import { type GroundingClaimInput, type GroundingValidator } from './grounding';
import type { ReviewGate } from './review';

export interface GuardrailRequest<T> {
  readonly projectId: ProjectId;
  readonly actorId: UserId;
  readonly runId?: WorkflowRunId;
  readonly workflow: string;
  readonly promptVersion: string;
  readonly riskTier: RiskTier;
  /** Raw, unsanitized user text. */
  readonly rawInput: string;
  /** Static, cacheable system prefix. */
  readonly system: string;
  readonly buildContextPack: (sanitizedText: string) => ContextPack | Promise<ContextPack>;
  readonly buildPrompt: (sanitizedText: string, pack: ContextPack) => string;
  readonly schema: z.ZodType<T>;
  readonly tier?: ModelTier;
  readonly maxTokens?: number;
  readonly stub?: () => T;
  /** Extract the claims (fields/endpoints/requirements) to ground-check. */
  readonly extractClaims?: (output: T) => GroundingClaimInput[];
  readonly artifactType?: string;
  readonly autoApprove?: boolean;
  readonly blockOnUngrounded?: boolean;
  /** Opt-in: re-scan the generated artifact for PII; any finding blocks export
   *  (for generators whose output must itself be PII-safe, e.g. synthetic data). */
  readonly rescanOutput?: boolean;
}

export interface GuardrailDeps {
  readonly config: ArbiterConfig;
  readonly tracer: Tracer;
  readonly sanitizer: SanitizePort;
  readonly llm: LlmProvider;
  readonly repos: RepositoryBundle;
  readonly grounding: GroundingValidator;
  readonly review: ReviewGate;
  readonly clock?: Clock;
}

const EMPTY_GROUNDING: GroundingReport = { claims: [], violations: 0, blockedExport: false };

// The output PII re-scan blocks on leaked PII *values*, not schema/column labels.
// Label-prone recognizers (MEMBER_ID matches "member_email", INTERNAL_URL matches
// hostnames-as-field-names) are excluded so a legitimate column name never blocks
// synthetic-data generation; real emails/SSNs/cards/secrets still do.
const OUTPUT_PII_BLOCK_TYPES = new Set([
  'PERSON',
  'EMAIL_ADDRESS',
  'PHONE_NUMBER',
  'US_SSN',
  'CREDIT_CARD',
  'API_KEY',
  'JWT',
  'PASSWORD',
  'IP_ADDRESS',
  'DATE_OF_BIRTH',
  'GENERIC_SECRET',
]);

function artifactStatusFor(decision: ReviewDecision): ArtifactStatus {
  switch (decision) {
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    default:
      return 'in_review';
  }
}

/**
 * The one code path every model call takes:
 *   sanitize -> ground -> generate -> validate -> gate
 * Each stage opens a span and appends an audit event. A sanitization hard-block
 * short-circuits before any model call. Never throws for expected policy
 * outcomes (blocked input, ungrounded output) — those are encoded in the result.
 */
export class GuardrailEngine {
  constructor(private readonly deps: GuardrailDeps) {}

  get tracer(): Tracer {
    return this.deps.tracer;
  }
  get repos(): RepositoryBundle {
    return this.deps.repos;
  }
  get sanitizer(): SanitizePort {
    return this.deps.sanitizer;
  }
  get sanitizerEngine(): SanitizePort['engine'] {
    return this.deps.sanitizer.engine;
  }

  async run<T>(req: GuardrailRequest<T>, runOpts: { tracer?: Tracer } = {}): Promise<GuardrailOutcome<T>> {
    const clock = this.deps.clock ?? systemClock;
    const tracer = runOpts.tracer ?? this.deps.tracer;
    const runId = req.runId ?? newWorkflowRunId();
    const model = this.deps.llm.modelFor(req.tier ?? 'default');
    const audit: AuditEvent[] = [];

    const appendAudit = async (
      action: AuditAction,
      detail: Record<string, unknown>,
      extra: { model?: string; promptVersion?: string; inputSha256?: string; sources?: string[] } = {},
    ): Promise<void> => {
      const event = AuditEvent.parse({
        id: newAuditEventId(),
        projectId: req.projectId,
        actorId: req.actorId,
        workflowRunId: runId,
        action,
        sources: extra.sources ?? [],
        detail,
        createdAt: nowIso(clock),
        ...(extra.model ? { model: extra.model } : {}),
        ...(extra.promptVersion ? { promptVersion: extra.promptVersion } : {}),
        ...(extra.inputSha256 ? { inputSha256: extra.inputSha256 } : {}),
      });
      await this.deps.repos.audit.append(event);
      audit.push(event);
    };

    const root = tracer.startSpan('workflow.run', {
      [ArbiterAttr.WORKFLOW]: req.workflow,
      [ArbiterAttr.PROJECT_ID]: req.projectId,
      [ArbiterAttr.RUN_ID]: runId,
    });

    try {
      await appendAudit('workflow.run', { workflow: req.workflow, riskTier: req.riskTier });

      // 1. Sanitize.
      const sanitization = await withSpan(root, 'sanitize', { [ArbiterAttr.STAGE]: 'sanitize' }, async (span) => {
        const report = await this.deps.sanitizer.sanitize(req.rawInput);
        span.setAttribute(ArbiterAttr.SANITIZE_FINDINGS, report.findings.length);
        span.setAttribute(ArbiterAttr.SANITIZE_BLOCKED, report.blocked);
        return report;
      });
      await appendAudit(
        'sanitize',
        {
          engine: sanitization.engine,
          findings: sanitization.findings.length,
          blocked: sanitization.blocked,
          blockReasons: sanitization.blockReasons,
        },
        { inputSha256: sanitization.originalSha256 },
      );

      // Sanitization hard-block short-circuits: no model call, artifact rejected.
      if (sanitization.blocked) {
        const review: ReviewRecord = { decision: 'rejected', riskTier: req.riskTier, mode: 'pre_approval' };
        await appendAudit('gate.decision', {
          decision: 'rejected',
          reason: 'sanitization_blocked',
          blockReasons: sanitization.blockReasons,
        });
        root.setStatus('ok');
        return {
          runId,
          projectId: req.projectId,
          sanitization,
          contextPack: buildContextPack(req.projectId, [], clock),
          output: null,
          grounding: EMPTY_GROUNDING,
          review,
          audit,
          model,
          promptVersion: req.promptVersion,
        };
      }

      // 2. Ground. Retrieved/grounding content is sanitized too — raw PHI in a
      // synced ticket or an uploaded doc must not reach the model via the context
      // pack (field names, being non-PII, survive so grounding still validates).
      const pack = await withSpan(root, 'ground', { [ArbiterAttr.STAGE]: 'ground' }, async (span) => {
        const built = await req.buildContextPack(sanitization.sanitizedText);
        const items = await Promise.all(
          built.items.map(async (it) => ({
            ...it,
            content: (await this.deps.sanitizer.sanitize(it.content)).sanitizedText,
          })),
        );
        const grounded: ContextPack = { ...built, items };
        span.setAttribute('arbiter.context.items', grounded.items.length);
        return grounded;
      });
      await appendAudit('ground', { items: pack.items.length }, { sources: pack.items.map((i) => i.citation) });

      // 3. Generate (structured).
      const prompt = req.buildPrompt(sanitization.sanitizedText, pack);
      const generation = await withSpan(
        root,
        'generate',
        {
          [ArbiterAttr.STAGE]: 'generate',
          [GenAI.SYSTEM]: 'anthropic',
          [GenAI.OPERATION_NAME]: 'generate',
          [GenAI.REQUEST_MODEL]: model,
        },
        async (span) => {
          const result = await this.deps.llm.generate({
            system: req.system,
            prompt,
            schema: req.schema,
            ...(req.tier ? { tier: req.tier } : {}),
            ...(req.maxTokens ? { maxTokens: req.maxTokens } : {}),
            ...(req.stub ? { stub: req.stub } : {}),
          });
          span.setAttribute(GenAI.RESPONSE_MODEL, result.model);
          span.setAttribute(GenAI.USAGE_INPUT_TOKENS, result.usage.inputTokens);
          span.setAttribute(GenAI.USAGE_OUTPUT_TOKENS, result.usage.outputTokens);
          return result;
        },
      );
      await appendAudit(
        'generate',
        { inputTokens: generation.usage.inputTokens, outputTokens: generation.usage.outputTokens },
        { model: generation.model, promptVersion: req.promptVersion },
      );

      // 4. Validate (grounding).
      const claims = req.extractClaims ? req.extractClaims(generation.output) : [];
      const grounding = await withSpan(root, 'validate', { [ArbiterAttr.STAGE]: 'validate' }, async (span) => {
        const report = this.deps.grounding.validate(claims, pack, { blockOnViolation: req.blockOnUngrounded ?? true });
        span.setAttribute(ArbiterAttr.GROUNDING_VIOLATIONS, report.violations);
        return report;
      });
      await appendAudit('validate', {
        claims: grounding.claims.length,
        violations: grounding.violations,
        blockedExport: grounding.blockedExport,
      });

      // 4b. Output PII re-scan (opt-in). The generated artifact must itself be
      // PII-safe (e.g. a synthetic test-data generator). Any finding blocks
      // export exactly like a grounding violation — you cannot ship generated PII.
      let outputPiiBlocked = false;
      if (req.rescanOutput && generation.output != null) {
        const rescan = await withSpan(root, 'validate', { [ArbiterAttr.STAGE]: 'validate' }, async (span) => {
          const report = await this.deps.sanitizer.sanitize(JSON.stringify(generation.output));
          span.setAttribute(ArbiterAttr.SANITIZE_FINDINGS, report.findings.length);
          return report;
        });
        const blocking = rescan.findings.filter((f) => OUTPUT_PII_BLOCK_TYPES.has(f.type));
        outputPiiBlocked = rescan.blocked || blocking.length > 0;
        await appendAudit('validate', {
          stage: 'output_pii_rescan',
          findings: blocking.length,
          types: [...new Set(blocking.map((f) => f.type))],
          blocked: outputPiiBlocked,
        });
      }

      // 5. Gate (review).
      const review = await withSpan(root, 'gate', { [ArbiterAttr.STAGE]: 'gate' }, async (span) => {
        const decision = this.deps.review.decide({
          riskTier: req.riskTier,
          groundingBlocked: grounding.blockedExport,
          outputPiiBlocked,
          ...(req.autoApprove !== undefined ? { autoApprove: req.autoApprove } : {}),
        });
        span.setAttribute(ArbiterAttr.REVIEW_DECISION, decision.decision);
        span.setAttribute(ArbiterAttr.REVIEW_RISK, decision.riskTier);
        return decision;
      });
      await appendAudit('gate.decision', { decision: review.decision, mode: review.mode });

      // Persist the reviewable artifact.
      const artifact = Artifact.parse({
        id: newArtifactId(),
        projectId: req.projectId,
        workflowRunId: runId,
        type: req.artifactType ?? req.workflow,
        status: artifactStatusFor(review.decision),
        riskTier: req.riskTier,
        content: generation.output,
        model: generation.model,
        promptVersion: req.promptVersion,
        createdBy: req.actorId,
        createdAt: nowIso(clock),
      });
      await this.deps.repos.artifacts.create(artifact);

      root.setStatus('ok');
      return {
        runId,
        projectId: req.projectId,
        sanitization,
        contextPack: pack,
        output: generation.output,
        grounding,
        review,
        audit,
        model: generation.model,
        promptVersion: req.promptVersion,
      };
    } catch (error) {
      root.recordException(error);
      throw error;
    } finally {
      root.end();
    }
  }
}
