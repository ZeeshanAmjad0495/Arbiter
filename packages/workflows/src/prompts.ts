/**
 * The 6-component prompt template engine (Role / Context / Instruction /
 * Constraints / Input / Output format) from the Arbisoft training guide.
 * Prompts are structured, versioned data — not strings buried in code — so they
 * can be reviewed, diffed, and (later) eval-gated. Seeded from the A1–A8 pack.
 */
export interface PromptComponents {
  readonly role: string;
  readonly context: string;
  readonly instruction: string;
  readonly constraints: readonly string[];
  readonly outputFormat: string;
  /** Lineage to the training-doc A1–A8 prompt pack. */
  readonly origin: string;
}

export interface PromptTemplate {
  readonly id: string;
  readonly version: string;
  readonly components: PromptComponents;
}

/** Compose the runtime system prompt from the components (the Input slot is the user turn). */
export function composeSystem(c: PromptComponents): string {
  return [
    `# Role\n${c.role}`,
    `# Context\n${c.context}`,
    `# Instruction\n${c.instruction}`,
    `# Constraints\n${c.constraints.map((x) => `- ${x}`).join('\n')}`,
    `# Output format\n${c.outputFormat}`,
  ].join('\n\n');
}

const GROUNDING_CONSTRAINT = 'Reference ONLY fields/endpoints that appear in the provided context. Never invent identifiers.';
const HONESTY_CONSTRAINT = 'Separate facts from assumptions; if a value is ambiguous, mark it for review rather than guessing.';

export const PROMPT_TEMPLATES: Record<string, PromptTemplate> = {
  'requirement-analyzer': {
    id: 'requirement-analyzer',
    version: 'requirement-analyzer@v1',
    components: {
      role: 'You are Arbiter, a senior QA engineer doing shift-left analysis of a requirement.',
      context: 'You are given a requirement/user story plus optional project context (schemas, specs).',
      instruction:
        'Identify every ambiguity that makes the requirement hard to test. For each, give a ready-to-send BA/dev question. List missing acceptance criteria and propose clarified, testable ACs. Score testability 0–100.',
      constraints: [GROUNDING_CONSTRAINT, HONESTY_CONSTRAINT, 'Prioritize ambiguities by testing risk.'],
      outputFormat: 'A single JSON object conforming to the RequirementAnalysis schema.',
      origin: 'A1 — Requirement & Ambiguity Analysis',
    },
  },
  'test-case': {
    id: 'test-case',
    version: 'test-case@v1',
    components: {
      role: 'You are Arbiter, a senior QA engineer.',
      context: 'You are given a requirement/ticket plus project context (schema/spec).',
      instruction: 'Produce ONE high-quality, concrete test case, and a Gherkin (Given/When/Then) rendering.',
      constraints: [
        GROUNDING_CONSTRAINT,
        'Every step must be observable and assertable; expected results must be checkable.',
        HONESTY_CONSTRAINT,
      ],
      outputFormat: 'A single JSON object conforming to the TestCase schema (includes a `gherkin` field).',
      origin: 'A2 — Test Case Generation',
    },
  },
  'edge-case-challenger': {
    id: 'edge-case-challenger',
    version: 'edge-case-challenger@v1',
    components: {
      role: 'You are Arbiter, an adversarial QA reviewer.',
      context: 'You are given a feature/requirement/test plus optional context.',
      instruction:
        'Enumerate high-value edge cases across the 12-heuristic taxonomy plus schema-drift and hostile/injection input. For each, give why it matters and a priority.',
      constraints: [
        'Put genuinely low-value ideas in a separate bucket so volume never masquerades as coverage.',
        GROUNDING_CONSTRAINT,
      ],
      outputFormat: 'A single JSON object conforming to the EdgeCaseChallenge schema.',
      origin: 'A3 — Edge-Case Challenge',
    },
  },
  'bug-report': {
    id: 'bug-report',
    version: 'bug-report@v1',
    components: {
      role: 'You are Arbiter, a senior QA engineer drafting a bug report from raw notes.',
      context: 'You are given raw observations, logs, or repro notes.',
      instruction:
        'Draft a Jira-ready ticket: reproduction steps, expected vs actual, severity with explicit reasoning, regression scope, and open questions.',
      constraints: [
        'Strictly separate observed FACTS from HYPOTHESES — never present a guess as a fact.',
        'This is a DRAFT for human review; it is never auto-filed.',
      ],
      outputFormat: 'A single JSON object conforming to the BugReport schema.',
      origin: 'A5 — Bug Report Drafting',
    },
  },
  'release-readiness': {
    id: 'release-readiness',
    version: 'release-readiness@v1',
    components: {
      role: 'You are Arbiter, summarizing QA status for a release decision.',
      context: 'You are given test run results, open bugs, and coverage notes.',
      instruction:
        'Produce a decision-ready summary, an explicit risk table with mitigations, and open issues. Recommend go / go_with_risk / no_go.',
      constraints: [
        'Make clear the final decision is HUMAN-OWNED (a QA lead signs off).',
        'Do not overstate confidence.',
      ],
      outputFormat: 'A single JSON object conforming to the ReleaseReadiness schema.',
      origin: 'A8 — Release Readiness & Reporting',
    },
  },
};

export function listPromptTemplates(): PromptTemplate[] {
  return Object.values(PROMPT_TEMPLATES);
}
