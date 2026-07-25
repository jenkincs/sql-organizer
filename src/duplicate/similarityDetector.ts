import { SimilarityCandidate, SqlInventoryItem } from '../domain/models';
function jaccard(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]).size;
  return union ? [...a].filter((x) => b.has(x)).length / union : 0;
}
const structuralTokens = new Set(['SELECT', 'FROM', 'JOIN', 'WHERE', 'GROUP', 'ORDER', 'INSERT', 'UPDATE', 'DELETE']);
function candidateKeys(item: SqlInventoryItem): string[] {
  if (item.exactDuplicateGroupId) return [];
  const tables = [...new Set(item.tables.map((table) => table.toLowerCase()))];
  if (tables.length) return tables.map((table) => `${item.operation}:table:${table}`);
  const shape = item.normalizedTokens.filter((token) => structuralTokens.has(token)).join(',') || 'no-structure';
  return [`${item.operation}:shape:${shape}`];
}
/** Uses operation/table (or structural shape) buckets so unrelated SQL is never compared. */
export function findSimilarities(items: SqlInventoryItem[], threshold: number): SimilarityCandidate[] {
  const buckets = new Map<string, number[]>();
  items.forEach((item, index) =>
    candidateKeys(item).forEach((key) => buckets.set(key, [...(buckets.get(key) ?? []), index])),
  );
  const pairs = new Set<string>();
  for (const indexes of buckets.values())
    for (let i = 0; i < indexes.length; i += 1)
      for (let j = i + 1; j < indexes.length; j += 1) pairs.add(`${indexes[i]}:${indexes[j]}`);
  const result: SimilarityCandidate[] = [];
  for (const pair of pairs) {
    const [leftIndex, rightIndex] = pair.split(':').map(Number);
    const left = items[leftIndex];
    const right = items[rightIndex];
    const sizeRatio =
      Math.min(left.sizeBytes, right.sizeBytes) / Math.max(1, Math.max(left.sizeBytes, right.sizeBytes));
    const tables = jaccard(left.tables, right.tables);
    if (sizeRatio < 0.35 || (left.tables.length && right.tables.length && tables === 0)) continue;
    const tokens = jaccard(left.normalizedTokens, right.normalizedTokens);
    const structural = jaccard(
      left.normalizedTokens.filter((x) => structuralTokens.has(x)),
      right.normalizedTokens.filter((x) => structuralTokens.has(x)),
    );
    const score = 0.45 * tokens + 0.25 * tables + 0.15 + 0.15 * structural;
    if (score >= threshold)
      result.push({
        leftId: left.id,
        rightId: right.id,
        score,
        reason: 'normalized token, table, operation, and structural similarity',
      });
  }
  return result;
}
