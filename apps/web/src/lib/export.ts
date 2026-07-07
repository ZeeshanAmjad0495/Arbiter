// Client-side artifact export: Markdown / CSV / JSON / Gherkin.

function humanize(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function toMarkdown(title: string, output: unknown): string {
  const lines: string[] = [`# ${title}`, ''];
  if (isObject(output)) {
    for (const [key, value] of Object.entries(output)) {
      lines.push(`## ${humanize(key)}`);
      if (Array.isArray(value)) {
        if (value.length === 0) {
          lines.push('_(none)_');
        } else if (isObject(value[0])) {
          const cols = [...new Set(value.flatMap((r) => Object.keys(r as object)))];
          lines.push(`| ${cols.map(humanize).join(' | ')} |`);
          lines.push(`| ${cols.map(() => '---').join(' | ')} |`);
          for (const row of value as Record<string, unknown>[]) {
            lines.push(`| ${cols.map((c) => String(row[c] ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`);
          }
        } else {
          for (const item of value) lines.push(`- ${String(item)}`);
        }
      } else if (isObject(value)) {
        lines.push('```json', JSON.stringify(value, null, 2), '```');
      } else {
        lines.push(String(value));
      }
      lines.push('');
    }
  } else {
    lines.push('```json', JSON.stringify(output, null, 2), '```');
  }
  return lines.join('\n');
}

export function toCsv(output: unknown): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  if (isObject(output)) {
    const arrKey = Object.keys(output).find(
      (k) => Array.isArray(output[k]) && (output[k] as unknown[]).length > 0 && isObject((output[k] as unknown[])[0]),
    );
    if (arrKey) {
      const rows = output[arrKey] as Record<string, unknown>[];
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      return [cols.map(esc).join(','), ...rows.map((r) => cols.map((c) => esc(String(r[c] ?? ''))).join(','))].join('\n');
    }
    return [
      'key,value',
      ...Object.entries(output).map(([k, v]) => `${esc(k)},${esc(isObject(v) || Array.isArray(v) ? JSON.stringify(v) : String(v))}`),
    ].join('\n');
  }
  return String(output);
}

export function gherkinOf(output: unknown): string | undefined {
  if (isObject(output) && typeof output.gherkin === 'string') return output.gherkin;
  return undefined;
}

export function download(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
