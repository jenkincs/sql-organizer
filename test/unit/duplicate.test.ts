import { describe, expect, it } from 'vitest';
import { assignExactDuplicateGroups } from '../../src/duplicate/exactDuplicateDetector';
import { findSimilarities } from '../../src/duplicate/similarityDetector';
import { SqlInventoryItem } from '../../src/domain/models';
const item = (id: string, hash: string) => ({ id, normalizedHash: hash }) as SqlInventoryItem;
describe('exact duplicate detector', () =>
  it('groups same normalized SQL without deleting anything', () => {
    const items = [item('a', 'x'), item('b', 'x'), item('c', 'y')];
    assignExactDuplicateGroups(items);
    expect(items[0].exactDuplicateGroupId).toBe(items[1].exactDuplicateGroupId);
    expect(items[2].exactDuplicateGroupId).toBeUndefined();
  }));

describe('similarity detector', () => {
  const similarItem = (id: string, table: string, token = 'status'): SqlInventoryItem => ({
    id,
    uri: `file:///${id}.sql`,
    relativePath: `${id}.sql`,
    sizeBytes: 120,
    modifiedAt: 1,
    rawHash: id,
    normalizedHash: id,
    normalizedTokens: ['SELECT', 'FROM', table, 'WHERE', token],
    operation: 'SELECT',
    dialectHint: 'generic',
    tables: [table],
    parameters: [],
    warnings: [],
    classificationStatus: 'not-analyzed',
  });
  it('only emits credible normalized-token candidates', () => {
    expect(findSimilarities([similarItem('a', 'orders'), similarItem('b', 'orders')], 0.72)).toHaveLength(1);
    expect(findSimilarities([similarItem('a', 'orders'), similarItem('b', 'customers')], 0.72)).toHaveLength(0);
  });
  it('uses candidate buckets for a large unrelated collection', () => {
    const items = Array.from({ length: 500 }, (_, index) => similarItem(String(index), `table_${index}`));
    const started = performance.now();
    expect(findSimilarities(items, 0.72)).toHaveLength(0);
    expect(performance.now() - started).toBeLessThan(250);
  });
});
