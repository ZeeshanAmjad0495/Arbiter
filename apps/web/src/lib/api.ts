// Thin client for the Arbiter API. In dev, Vite proxies these paths to :4310.

// The selected project is initialized synchronously from localStorage so the
// very first request already carries it, then sent as `x-arbiter-project` on
// every call — the server scopes all reads/writes (and Postgres RLS) to it.
let activeProjectId: string | null = typeof localStorage !== 'undefined' ? localStorage.getItem('arbiter-project') : null;

export function getActiveProject(): string | null {
  return activeProjectId;
}

export function setActiveProject(id: string | null): void {
  activeProjectId = id;
  if (typeof localStorage === 'undefined') return;
  if (id) localStorage.setItem('arbiter-project', id);
  else localStorage.removeItem('arbiter-project');
}

function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (activeProjectId) headers.set('x-arbiter-project', activeProjectId);
  return fetch(path, { ...init, headers });
}

export interface ProjectInfo {
  id: string;
  name: string;
  classification: string;
  createdAt: string;
}

export async function listProjects(): Promise<{ defaultProjectId: string; projects: ProjectInfo[] }> {
  const res = await apiFetch('/v1/projects');
  if (!res.ok) throw new Error(`projects ${res.status}`);
  return res.json();
}

export interface QualityMetrics {
  projectId: string;
  totals: { artifacts: number; reviews: number };
  byStatus: Record<string, number>;
  byRiskTier: Record<string, number>;
  byWorkflow: { type: string; count: number; approved: number; rejected: number }[];
  review: { decided: number; approvalRate: number | null; editRate: number | null; medianDwellMs: number | null };
  grounding: { validated: number; withViolations: number; violationRate: number | null };
  generatedAt: string;
}

export async function getMetrics(): Promise<QualityMetrics> {
  const res = await apiFetch('/v1/metrics');
  if (!res.ok) throw new Error(`metrics ${res.status}`);
  return (await res.json()).metrics;
}

export async function createProject(body: { name: string; classification?: string }): Promise<ProjectInfo> {
  const res = await apiFetch('/v1/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Create project failed (${res.status}): ${detail}`);
  }
  return (await res.json()).project;
}

export interface Finding {
  type: string;
  start: number;
  end: number;
  placeholder: string;
  score: number;
  engine: string;
}

export interface Claim {
  kind: string;
  value: string;
  status: 'grounded' | 'ungrounded' | 'unknown';
  foundIn?: string;
}

export interface TestCase {
  title: string;
  testType: string;
  priority: string;
  preconditions: string[];
  steps: string[];
  expectedResult: string;
  fieldsReferenced: string[];
  assumptions: string[];
  gherkin: string;
}

export interface SpanData {
  name: string;
  attributes: Record<string, string | number | boolean>;
  status: string;
  startMs: number;
  endMs?: number;
  events: { name: string }[];
  children: SpanData[];
}

export interface Outcome {
  workflow: string;
  outputView: 'test_case' | 'generic';
  runId: string;
  model: string;
  sanitization: {
    engine: string;
    blocked: boolean;
    blockReasons: string[];
    sanitizedText: string;
    findings: Finding[];
  };
  contextPack: { id: string; title: string; citation: string; classification: string; syncedAt: string | null }[];
  output: unknown;
  grounding: { claims: Claim[]; violations: number; blockedExport: boolean };
  review: { decision: string; riskTier: string; mode: string };
  audit: { action: string; at: string; detail: Record<string, unknown> }[];
  trace: { text: string; tree: SpanData } | null;
}

export interface WorkflowMeta {
  id: string;
  label: string;
  description: string;
  defaultRiskTier: 'low' | 'medium' | 'high';
  ui: {
    requirementLabel: string;
    requirementPlaceholder: string;
    sampleRequirement: string;
    sampleContext?: { title: string; content: string };
    outputView: 'test_case' | 'generic';
  };
}

export interface ContextInput {
  title: string;
  content: string;
  sourceType?: string;
}

export interface RunRequest {
  requirement: string;
  context: ContextInput[];
  riskTier: 'low' | 'medium' | 'high';
  autoApprove: boolean;
  simulateHallucination: boolean;
  useKnowledge?: boolean;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  sourceType: string;
  classification: string;
  createdAt: string;
}

export async function listKnowledge(): Promise<KnowledgeDoc[]> {
  const res = await apiFetch('/v1/knowledge');
  if (!res.ok) throw new Error(`knowledge ${res.status}`);
  return (await res.json()).documents;
}

export async function addKnowledge(body: { title: string; content: string; sourceType?: string }): Promise<{ id: string; chunks: number }> {
  const res = await apiFetch('/v1/knowledge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Add knowledge failed (${res.status}): ${detail}`);
  }
  return (await res.json()).document;
}

export async function deleteKnowledge(id: string): Promise<void> {
  const res = await apiFetch(`/v1/knowledge/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete knowledge ${res.status}`);
}

export interface StatusInfo {
  modes: { persistence: string; sanitizer: string; llm: string; telemetry: string; demask: string };
  models: { draft: string; default: string; judge: string };
}

export async function getStatus(): Promise<StatusInfo> {
  const res = await apiFetch('/api/status');
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

export async function listWorkflows(): Promise<WorkflowMeta[]> {
  const res = await apiFetch('/v1/workflows');
  if (!res.ok) throw new Error(`workflows ${res.status}`);
  return (await res.json()).workflows;
}

export async function runWorkflow(id: string, body: RunRequest): Promise<Outcome> {
  const res = await apiFetch(`/v1/workflows/${id}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Request failed (${res.status}): ${detail}`);
  }
  return res.json();
}

export async function fetchJira(key: string): Promise<ContextInput> {
  const res = await apiFetch(`/v1/jira/${encodeURIComponent(key)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? `Jira fetch failed (${res.status})`);
  return data.context;
}

/* ----- Review queue ----- */

export interface ReviewItem {
  id: string;
  type: string;
  riskTier: string;
  status: string;
  model: string | null;
  createdAt: string;
  summary: string;
}

export interface Artifact {
  id: string;
  type: string;
  status: string;
  riskTier: string;
  content: unknown;
  model?: string;
  promptVersion?: string;
  workflowRunId: string;
  createdAt: string;
}

export interface ReviewLog {
  id: string;
  decision: string;
  mode: string;
  riskTier: string;
  editDiff?: string;
  dwellMs?: number;
  decidedAt?: string;
  createdAt: string;
}

export async function listReviews(): Promise<ReviewItem[]> {
  const res = await apiFetch('/v1/reviews');
  if (!res.ok) throw new Error(`reviews ${res.status}`);
  return (await res.json()).reviews;
}

export async function getArtifact(id: string): Promise<{ artifact: Artifact; reviews: ReviewLog[] }> {
  const res = await apiFetch(`/v1/artifacts/${id}`);
  if (!res.ok) throw new Error(`artifact ${res.status}`);
  return res.json();
}

/* ----- Prompt library ----- */

export interface PromptTemplate {
  id: string;
  version: string;
  label: string;
  components: {
    role: string;
    context: string;
    instruction: string;
    constraints: string[];
    outputFormat: string;
    origin: string;
  };
}

export async function listPrompts(): Promise<PromptTemplate[]> {
  const res = await apiFetch('/v1/prompts');
  if (!res.ok) throw new Error(`prompts ${res.status}`);
  return (await res.json()).prompts;
}

export async function submitReview(
  id: string,
  body: { decision: 'approved' | 'rejected' | 'needs_changes'; editedContent?: unknown; dwellMs?: number },
): Promise<{ artifact: Artifact; review: ReviewLog }> {
  const res = await apiFetch(`/v1/artifacts/${id}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Review failed (${res.status}): ${detail}`);
  }
  return res.json();
}
