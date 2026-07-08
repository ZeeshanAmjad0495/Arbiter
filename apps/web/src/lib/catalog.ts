// Groups the 39 workflows into a scannable catalog (presentation-only; the API is
// the source of truth for the workflows themselves).

export interface CatalogCategory {
  key: string;
  label: string;
  blurb: string;
}

export const CATEGORIES: CatalogCategory[] = [
  { key: 'author', label: 'Author & Design', blurb: 'Draft requirements, test cases, strategy, plans, and specs.' },
  { key: 'analyze', label: 'Analyze & Trace', blurb: 'Traceability, coverage, drift, impact, and consistency checks.' },
  { key: 'operate', label: 'Operate & Respond', blurb: 'CI triage, incidents, release readiness, and resilience.' },
  { key: 'data', label: 'Data & Reporting', blurb: 'Synthetic data, DQ assertions, migrations, and reports.' },
];

const CATEGORY_OF: Record<string, string> = {
  // Author & Design
  'requirement-analyzer': 'author',
  'test-case': 'author',
  'edge-case-challenger': 'author',
  'nfr-analyzer': 'author',
  'test-strategy': 'author',
  'test-plan': 'author',
  'api-test-generator': 'author',
  'security-abuse-cases': 'author',
  'exploratory-charter': 'author',
  'uat-script': 'author',
  'smoke-suite': 'author',
  'accessibility-ac': 'author',
  'performance-test-plan': 'author',
  'persona-scenarios': 'author',
  'mobile-test-cases': 'author',
  // Analyze & Trace
  'traceability-matrix': 'analyze',
  'compliance-mapping': 'analyze',
  'contract-drift': 'analyze',
  'cross-req-inconsistency': 'analyze',
  'spec-change-impact': 'analyze',
  'regression-impact': 'analyze',
  'nfr-result-triage': 'analyze',
  'mutation-survivors': 'analyze',
  'feature-flag-matrix': 'analyze',
  // Operate & Respond
  'release-readiness': 'operate',
  'operational-readiness-gate': 'operate',
  'ci-failure-triage': 'operate',
  'flaky-test-advisor': 'operate',
  'incident-postmortem': 'operate',
  'chaos-gameday': 'operate',
  'dr-drill': 'operate',
  'sre-runbook': 'operate',
  'ops-config': 'operate',
  // Data & Reporting
  'bug-report': 'data',
  'data-quality-assertions': 'data',
  'migration-test-plan': 'data',
  'exec-quality-report': 'data',
  'synthetic-test-data': 'data',
  'test-estimation': 'data',
};

export function categoryOf(id: string): string {
  return CATEGORY_OF[id] ?? 'author';
}
