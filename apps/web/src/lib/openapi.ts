import { parse as parseYaml } from 'yaml';
import type { ContextInput } from '$lib/api';

interface OpenApiSpec {
  info?: { title?: string; version?: string };
  paths?: Record<string, Record<string, { parameters?: Array<{ name?: string }> }>>;
  components?: { schemas?: Record<string, { properties?: Record<string, unknown> }> };
}

/**
 * Parse an uploaded OpenAPI/JSON-Schema spec (JSON or YAML) into a single
 * grounding context item — endpoints + field names — so the grounding validator
 * can check generated references against the real spec (Phase 1 grounding pull-forward).
 */
export function openApiToContext(text: string, filename: string): ContextInput {
  let spec: OpenApiSpec;
  try {
    spec = JSON.parse(text) as OpenApiSpec;
  } catch {
    spec = parseYaml(text) as OpenApiSpec;
  }

  const endpoints: string[] = [];
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      if (!op || typeof op !== 'object') continue;
      const params = (op.parameters ?? []).map((p) => p.name).filter((n): n is string => !!n);
      endpoints.push(`${method.toUpperCase()} ${path}${params.length ? ` (params: ${params.join(', ')})` : ''}`);
    }
  }

  const fields = new Set<string>();
  for (const schema of Object.values(spec.components?.schemas ?? {})) {
    for (const field of Object.keys(schema.properties ?? {})) fields.add(field);
  }

  const title = spec.info?.title ?? filename;
  const content = [
    `OpenAPI: ${title}${spec.info?.version ? ` ${spec.info.version}` : ''}`,
    endpoints.length ? `Endpoints:\n${endpoints.join('\n')}` : '',
    fields.size ? `Fields: ${[...fields].join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { title, content, sourceType: 'openapi' };
}
