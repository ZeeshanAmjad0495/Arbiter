import { type ContextPack, ContextPackItem, type ProjectId, nowIso } from '@arbiter/core';
import type { Clock } from '@arbiter/core';

/** Build a user-visible context pack from raw items (the Context Pack Builder seam). */
export function buildContextPack(
  projectId: ProjectId,
  items: ReadonlyArray<Partial<ContextPackItem> & Pick<ContextPackItem, 'sourceType' | 'title' | 'content' | 'citation'>>,
  clock?: Clock,
): ContextPack {
  const packItems = items.map((item, idx) =>
    ContextPackItem.parse({
      id: item.id ?? `ctx-${idx}`,
      sourceType: item.sourceType,
      title: item.title,
      content: item.content,
      citation: item.citation,
      classification: item.classification ?? 'internal',
      ...(item.syncedAt ? { syncedAt: item.syncedAt } : {}),
    }),
  );
  return {
    id: `pack-${projectId}-${packItems.length}`,
    projectId,
    items: packItems,
    assembledAt: nowIso(clock),
  };
}
