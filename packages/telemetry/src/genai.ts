/**
 * OpenTelemetry GenAI semantic-convention attribute keys.
 * Instrumenting to these keys keeps traces portable to Langfuse / any OTLP
 * backend the moment we add the exporter adapter (see README "telemetry").
 * Ref: OpenTelemetry semantic conventions for Generative AI.
 */
export const GenAI = {
  SYSTEM: 'gen_ai.system',
  OPERATION_NAME: 'gen_ai.operation.name',
  REQUEST_MODEL: 'gen_ai.request.model',
  RESPONSE_MODEL: 'gen_ai.response.model',
  USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
} as const;

/** Arbiter-specific attributes, namespaced to avoid clashing with the spec. */
export const ArbiterAttr = {
  PROJECT_ID: 'arbiter.project.id',
  WORKFLOW: 'arbiter.workflow',
  RUN_ID: 'arbiter.run.id',
  STAGE: 'arbiter.stage',
  SANITIZE_FINDINGS: 'arbiter.sanitize.findings',
  SANITIZE_BLOCKED: 'arbiter.sanitize.blocked',
  GROUNDING_VIOLATIONS: 'arbiter.grounding.violations',
  REVIEW_DECISION: 'arbiter.review.decision',
  REVIEW_RISK: 'arbiter.review.risk',
} as const;
