// Groups the 39 workflows into a scannable catalog (presentation-only; the API is
// the source of truth for the workflows themselves).

export interface CatalogCategory {
  key: string;
  label: string;
  icon: string;
}

export const CATEGORIES: CatalogCategory[] = [
  { key: 'author', label: 'Author & Design', icon: '✏️' },
  { key: 'analyze', label: 'Analyze & Trace', icon: '🔎' },
  { key: 'operate', label: 'Operate & Respond', icon: '⚙️' },
  { key: 'data', label: 'Data & Reporting', icon: '📊' },
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

export function iconOf(id: string): string {
  return CATEGORIES.find((c) => c.key === categoryOf(id))?.icon ?? '•';
}
