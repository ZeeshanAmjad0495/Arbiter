/**
 * Zuub test corpus — 12 realistic tickets spanning every Zuub subsystem at varying
 * complexity, used to drive the end-to-end flow tests. Zuub is a dental
 * insurance-verification / claim-retrieval automation platform, so the tickets read
 * like its real Jira issues (payers, eligibility, claims, credentials, bots, PMS syncs).
 *
 * NOTE: all PII here is synthetic. The one "credential" ticket assembles a fake
 * secret at load time so no literal secret is committed; it exists purely to prove the
 * sanitizer hard-blocks before the model call.
 */

export type Complexity = 'low' | 'medium' | 'high';

export interface ZuubTicket {
  key: string;
  title: string;
  /** Zuub subsystem this ticket exercises. */
  area: string;
  complexity: Complexity;
  /** Arbiter workflow to run this ticket through. */
  workflow: string;
  riskTier: 'low' | 'medium' | 'high';
  content: string;
  /** What the guardrail pipeline should do with it (asserted by the E2E). */
  expect: { pii?: boolean; credential?: boolean };
}

// Proven-to-block form (see tests/guardrail.test.ts); assembled so no literal secret is stored.
const FAKE_PORTAL_KEY = ['sk', 'ABCDEF0123456789ABCDEF'].join('-');

export const ZUUB_TICKETS: ZuubTicket[] = [
  {
    key: 'IV-4101',
    title: 'Delta Dental eligibility returns wrong individual deductible',
    area: 'insurance-verification',
    complexity: 'low',
    workflow: 'bug-report',
    riskTier: 'low',
    content: [
      'For Delta Dental PPO, the insurance verification response reports the family deductible in the',
      'individual_deductible field. Expected: individual_deductible reflects the member-level remaining amount.',
      'Fields involved: individual_deductible, family_deductible, coverage_status, plan_name.',
      'Endpoint: /v1/insurance-verifications. Payer: Delta Dental. Reproduces on staging for plan Premier.',
    ].join(' '),
    expect: {},
  },
  {
    key: 'CL-2277',
    title: 'Cigna claim retrieval poll times out after 30s',
    area: 'claim-retrieval',
    complexity: 'medium',
    workflow: 'incident-postmortem',
    riskTier: 'medium',
    content: [
      'Claim retrieval for Cigna intermittently times out. The poll-for-claim-retrieval step exceeds the 30s budget',
      'when the payer portal is slow, leaving claim_status = pending and no paid_amount.',
      'Affected endpoint: /v1/claim-retrievals. Fields: claim_status, paid_amount, processed_date.',
      'Impact: ~4% of Cigna claims per batch require a manual retry. Started after the payer network change.',
    ].join(' '),
    expect: {},
  },
  {
    key: 'CRED-908',
    title: 'Availity portal credential validation failing for an office',
    area: 'credential-validation',
    complexity: 'medium',
    workflow: 'bug-report',
    riskTier: 'medium',
    content: [
      'Credential validation keeps returning invalid_credentials for the Availity portal.',
      `The office shared their portal login for debugging: username=frontdesk@smiledental.example password=${FAKE_PORTAL_KEY}.`,
      'Please verify the credentials against Availity and confirm whether the secret_question step is the blocker.',
    ].join(' '),
    expect: { credential: true },
  },
  {
    key: 'IV-4188',
    title: 'Patient eligibility mismatch for member with active coverage',
    area: 'insurance-verification',
    complexity: 'medium',
    workflow: 'test-case',
    riskTier: 'low',
    content: [
      'A patient with active coverage is being returned as inactive.',
      'Patient: Gabriel Newton, email gabriel.newton@example.com, DOB 1984-07-02, phone 415-555-0148.',
      'Member fields: member_id, subscriber_id, coverage_status, effective_date, plan_type.',
      'Expected coverage_status = active for member_id on the Guardian plan. Verify the eligibility mapping.',
    ].join(' '),
    expect: { pii: true },
  },
  {
    key: 'PLAT-521',
    title: 'Add payer mapping for United Concordia via Stedi',
    area: 'payer-mapping',
    complexity: 'medium',
    workflow: 'test-case',
    riskTier: 'medium',
    content: [
      'We need a new payer mapping so United Concordia routes through the Stedi clearinghouse.',
      'Add payer_id resolution and network_status handling. Fields: payer_id, payer_name, network_status, clearinghouse.',
      'Verify the mapping resolves for both insurance-verification and claim-retrieval flows.',
    ].join(' '),
    expect: {},
  },
  {
    key: 'BOT-3412',
    title: 'Bot task_queues backlog on Firestore during peak',
    area: 'bot-orchestration',
    complexity: 'high',
    workflow: 'ci-failure-triage',
    riskTier: 'high',
    content: [
      'During peak load the bot task_queues backlog grows unbounded on Firestore, delaying verifications by hours.',
      'The default_bot_id pool saturates and Cloud Function invocations retry, inflating cost.',
      'Fields: task_queues, default_bot_id, bot_ids, function_name, project_id. Environment: production.',
      'We need to bound concurrency and add backpressure. Provide a triage of likely causes and the checks to run.',
    ].join(' '),
    expect: {},
  },
  {
    key: 'CS-1502',
    title: 'Coverage completeness rules miss orthodontics lifetime maximums',
    area: 'data-completeness',
    complexity: 'high',
    workflow: 'data-quality-assertions',
    riskTier: 'medium',
    content: [
      'The data completeness rules do not flag missing orthodontics lifetime maximums, so transformed results ship',
      'incomplete for ortho cases. Fields: lifetime_maximum, orthodontics_coverage, remaining_benefit, coverage_status.',
      'Define completeness assertions that fail when orthodontics_coverage is present but lifetime_maximum is absent.',
    ].join(' '),
    expect: {},
  },
  {
    key: 'IV-4260',
    title: 'Dentrix sync drops procedure codes for endodontics',
    area: 'pms-integration',
    complexity: 'medium',
    workflow: 'bug-report',
    riskTier: 'medium',
    content: [
      'The Dentrix PMS sync drops procedure_code values for endodontics during the write-back to the office.',
      'Fields: procedure_code, tooth_number, service_type. Only endodontics (root canal) codes are affected.',
      'Expected: all procedure_code values persist. Reproduces for the Heartland Dental office.',
    ].join(' '),
    expect: {},
  },
  {
    key: 'IV-4301',
    title: 'High incident: insurance-verification 500 error spike',
    area: 'observability',
    complexity: 'medium',
    workflow: 'incident-postmortem',
    riskTier: 'high',
    content: [
      'A high-severity incident: the insurance-verification service returned a spike of 500 errors for ~12 minutes.',
      'The alert fired on error_rate for function_name insurance-verification. Metric: error_rate, latency_ms.',
      'Suspected cause: an upstream payer portal outage. Produce the postmortem skeleton and the follow-up checks.',
    ].join(' '),
    expect: {},
  },
  {
    key: 'PLAT-540',
    title: 'Contract drift on /v1/claim-retrievals response schema',
    area: 'api-contract',
    complexity: 'high',
    workflow: 'contract-drift',
    riskTier: 'high',
    content: [
      'The /v1/claim-retrievals response changed shape: paid_amount moved under a nested claim object and',
      'processed_date is now an ISO string instead of epoch. Downstream transforms break.',
      'Fields: paid_amount, processed_date, claim_status, allowed_amount. Detect the drift and list the contract tests.',
    ].join(' '),
    expect: {},
  },
  {
    key: 'CS-1610',
    title: 'Abuse case: member_id enumeration via verification endpoint',
    area: 'security',
    complexity: 'high',
    workflow: 'security-abuse-cases',
    riskTier: 'high',
    content: [
      'The insurance-verification endpoint may allow member_id enumeration: sequential member_id values return',
      'distinguishable responses for valid vs invalid members. Endpoint: /v1/insurance-verifications.',
      'Fields: member_id, coverage_status. Enumerate the abuse cases and the mitigations to test.',
    ].join(' '),
    expect: {},
  },
  {
    key: 'CS-1700',
    title: 'Conflicting deductible-reset rules across specs',
    area: 'requirements',
    complexity: 'high',
    workflow: 'cross-req-inconsistency',
    riskTier: 'medium',
    content: [
      'Spec A says the individual_deductible resets on the plan effective_date (benefit year).',
      'Spec B says the individual_deductible resets on January 1 (calendar year) regardless of effective_date.',
      'These conflict for non-calendar plans. Fields: individual_deductible, effective_date, benefit_period.',
      'Identify the inconsistency and the tests that pin the correct behavior.',
    ].join(' '),
    expect: {},
  },
];

/** A valid + an invalid Zuub claim payload for the Data Format Checker (schema validation) flow. */
export const ZUUB_CLAIM_SCHEMA = JSON.stringify({
  type: 'object',
  required: ['claim_id', 'payer_id', 'claim_status', 'paid_amount'],
  properties: {
    claim_id: { type: 'string' },
    payer_id: { type: 'string' },
    claim_status: { type: 'string', enum: ['pending', 'paid', 'denied'] },
    paid_amount: { type: 'number', minimum: 0 },
    processed_date: { type: 'string' },
  },
  additionalProperties: false,
});

export const ZUUB_CLAIM_VALID = JSON.stringify({
  claim_id: 'CLM-100',
  payer_id: 'delta-dental',
  claim_status: 'paid',
  paid_amount: 128.5,
  processed_date: '2026-02-01',
});

export const ZUUB_CLAIM_INVALID = JSON.stringify({
  claim_id: 'CLM-101',
  payer_id: 'cigna',
  claim_status: 'processing', // not in enum
  paid_amount: -5, // below minimum
  member_ssn: '000-00-0000', // additionalProperties: false
});
