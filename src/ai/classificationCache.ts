import type { ClassificationRecord } from '../domain/models';

/**
 * Cached classifications are keyed by SQL content, not location. When a user moves a
 * workspace, bind the cached result to the newly scanned item ID so planning uses it.
 */
export function bindClassificationToItem(
  records: ClassificationRecord[],
  cached: ClassificationRecord,
  itemId: string,
): ClassificationRecord {
  const rebound = { ...cached, itemId };
  const existingIndex = records.findIndex((record) => record.itemId === itemId);
  if (existingIndex >= 0) records[existingIndex] = rebound;
  else records.push(rebound);
  return rebound;
}
