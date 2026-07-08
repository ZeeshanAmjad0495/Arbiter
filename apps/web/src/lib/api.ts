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

let sessionToken: string | null = typeof localStorage !== 'undefined' ? localStorage.getItem('arbiter-session') : null;

export function setSession(token: string | null): void {
  sessionToken = token;
  if (typeof localStorage === 'undefined') return;
  if (token) localStorage.setItem('arbiter-session', token);
  else localStorage.removeItem('arbiter-session');
}
export function hasSession(): boolean {
  return !!sessionToken;
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (activeProjectId) headers.set('x-arbiter-project', activeProjectId);
  if (sessionToken) headers.set('authorization', `Bearer ${sessionToken}`);
  const res = await fetch(path, { ...init, headers });
  // A 401 on a session-carrying request means the session is gone/expired → re-login.
  if (res.status === 401 && sessionToken && !path.startsWith('/v1/auth/')) {
    setSession(null);
    if (typeof location !== 'undefined') location.reload();
  }
  return res;
}

/* ----- Auth ----- */

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

export async function login(email: string, key: string): Promise<AuthUser> {
  const res = await fetch('/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, key }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error === 'invalid_credentials' ? 'Invalid email or access key.' : `Login failed (${res.status})`);
  }
  const data = await res.json();
  setSession(data.token);
  return data.user;
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/v1/auth/logout', { method: 'POST' });
  } catch {
    /* ignore */
  }
  setSession(null);
}

export async function getMe(): Promise<AuthUser | null> {
  // No token → don't even hit the network; a guaranteed 401 just logs a console
  // error and slows the initial paint of the login screen.
  if (!hasSession()) return null;
  const res = await apiFetch('/v1/auth/me');
  if (!res.ok) return null;
  return (await res.json()).user;
}

export async function issueKey(email: string, role = 'qa'): Promise<{ user: AuthUser; key: string }> {
  const res = await apiFetch('/v1/auth/issue-key', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Issue key failed (${res.status}): ${detail}`);
  }
  return res.json();
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
  execution: {
    runs: number;
    passRate: number | null;
    cases: { passed: number; failed: number; skipped: number };
    byKind: { kind: string; runs: number; passed: number; failed: number }[];
    lastStatus: string | null;
  };
  generatedAt: string;
}

export async function getMetrics(): Promise<QualityMetrics> {
  const res = await apiFetch('/v1/metrics');
  if (!res.ok) throw new Error(`metrics ${res.status}`);
  return (await res.json()).metrics;
}

export interface CreateProjectInput {
  name: string;
  classification?: string;
  description?: string;
  repoUrl?: string;
  repoPath?: string;
  context?: string;
  schemas?: { name: string; schema: string }[];
}

export async function createProject(body: CreateProjectInput): Promise<ProjectInfo> {
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

/* ----- Per-project JSON Schemas ----- */

export interface SchemaInfo {
  id: string;
  name: string;
  createdAt: string;
}

export async function listSchemas(): Promise<SchemaInfo[]> {
  const res = await apiFetch('/v1/schemas');
  if (!res.ok) throw new Error(`schemas ${res.status}`);
  return (await res.json()).schemas;
}

export async function getSchema(id: string): Promise<{ id: string; name: string; schema: unknown; createdAt: string }> {
  const res = await apiFetch(`/v1/schemas/${id}`);
  if (!res.ok) throw new Error(`schema ${res.status}`);
  return (await res.json()).schema;
}

export async function addSchema(body: { name: string; schema: string }): Promise<SchemaInfo> {
  const res = await apiFetch('/v1/schemas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Add schema failed (${res.status}): ${detail}`);
  }
  return (await res.json()).schema;
}

export async function deleteSchema(id: string, confirmKey: string): Promise<void> {
  const res = await apiFetch(`/v1/schemas/${id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmKey }) });
  if (!res.ok) throw new Error(await stepUpError(res, 'delete schema'));
}

/** Turn a destructive-action failure into a friendly message (step-up = wrong key). */
async function stepUpError(res: Response, what: string): Promise<string> {
  if (res.status === 403) return 'That access key did not match. Re-enter your key to confirm.';
  const detail = await res.text().catch(() => '');
  return `Failed to ${what} (${res.status}): ${detail}`;
}

export async function validateData(schemaId: string, data: string): Promise<ValidateResult> {
  const res = await apiFetch(`/v1/schemas/${schemaId}/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Validation failed (${res.status}): ${detail}`);
  }
  return res.json();
}

export interface ValidateError {
  path: string;
  message: string;
  keyword: string;
}
export interface ValidateResult {
  valid: boolean;
  errors: ValidateError[];
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
  useGraph?: boolean;
}

export interface GraphNodeDto {
  id: string;
  label: string;
  type: string;
  mentions: number;
}
export interface GraphEdgeDto {
  source: string;
  target: string;
  relation: string;
  weight: number;
}
export interface GraphData {
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
}

export async function getGraph(): Promise<GraphData> {
  const res = await apiFetch('/v1/graph');
  if (!res.ok) throw new Error(`graph ${res.status}`);
  return res.json();
}

export async function buildGraph(): Promise<{ nodes: number; edges: number }> {
  const res = await apiFetch('/v1/graph/build', { method: 'POST' });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Build graph failed (${res.status}): ${detail}`);
  }
  return (await res.json()).built;
}

export interface ExecutionCase {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  message?: string;
}
export interface TestExecution {
  id: string;
  kind: 'playwright' | 'k6';
  name: string;
  mode: 'real' | 'offline';
  status: 'passed' | 'failed' | 'error';
  summary: { total: number; passed: number; failed: number; skipped: number; durationMs: number };
  cases: ExecutionCase[];
  exitCode: number | null;
  error?: string;
  createdAt: string;
}

export async function runExecution(body: { kind: 'playwright' | 'k6'; script: string; name?: string }): Promise<TestExecution> {
  const res = await apiFetch('/v1/executions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Run failed (${res.status}): ${detail}`);
  }
  return (await res.json()).execution;
}

export async function listExecutions(): Promise<TestExecution[]> {
  const res = await apiFetch('/v1/executions');
  if (!res.ok) throw new Error(`executions ${res.status}`);
  return (await res.json()).executions;
}

export async function resolveDemask(text: string): Promise<{ text: string; resolved: number; unresolved: number }> {
  const res = await apiFetch('/v1/demask/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Re-identify failed (${res.status}): ${detail}`);
  }
  return res.json();
}

export async function purgeDemask(olderThanHours: number, confirmKey: string): Promise<{ removed: number }> {
  const res = await apiFetch('/v1/demask/purge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ olderThanHours, confirmKey }),
  });
  if (!res.ok) throw new Error(await stepUpError(res, 'purge mappings'));
  return res.json();
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

export async function deleteKnowledge(id: string, confirmKey: string): Promise<void> {
  const res = await apiFetch(`/v1/knowledge/${id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmKey }) });
  if (!res.ok) throw new Error(await stepUpError(res, 'delete document'));
}

export interface StatusInfo {
  modes: { persistence: string; sanitizer: string; llm: string; telemetry: string; demask: string; demaskDurable?: boolean; runner?: string };
  models: { draft: string; default: string; judge: string };
  authEnabled?: boolean;
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

export type RunStreamEvent =
  | { type: 'open'; workflow: string; outputView: string }
  | { type: 'stage'; stage: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'done'; outcome: Outcome }
  | { type: 'error'; message: string };

/** Run a workflow with Server-Sent Events: stage progress + reasoning deltas, then the outcome. */
export async function runWorkflowStream(id: string, body: RunRequest, onEvent: (e: RunStreamEvent) => void): Promise<void> {
  const res = await apiFetch(`/v1/workflows/${id}/run/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Request failed (${res.status}): ${detail}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const dispatch = (block: string) => {
    let ev = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) ev = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (ev === 'stage') onEvent({ type: 'stage', stage: String(parsed.stage) });
    else if (ev === 'reasoning') onEvent({ type: 'reasoning', delta: String(parsed.delta) });
    else if (ev === 'done') onEvent({ type: 'done', outcome: parsed as unknown as Outcome });
    else if (ev === 'error') onEvent({ type: 'error', message: String(parsed.message) });
    else if (ev === 'open') onEvent({ type: 'open', workflow: String(parsed.workflow), outputView: String(parsed.outputView) });
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      dispatch(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
  }
  if (buffer.trim()) dispatch(buffer);
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
