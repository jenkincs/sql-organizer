import { describe, expect, it } from 'vitest';
import { migrateClassifications, migrateInventory, migratePlan } from '../../src/storage/stateMigration';

describe('state migration', () => {
  it('adds unit provenance to legacy inventory entries', () => {
    const [item] = migrateInventory([
      { id: 'x', uri: 'file:///old/query.sql', relativePath: 'query.sql', rawHash: 'hash' },
    ]);
    expect(item.unitKind).toBe('file');
    expect(item.sourceFileUri).toBe(item.uri);
    expect(item.splitSafety).toBe('keep-together');
  });
  it('adds taxonomy metadata and action kinds to legacy state', () => {
    const [record] = migrateClassifications([
      { itemId: 'x', cacheKey: 'x', analyzedAt: 'now', classification: { category: 'customer' } },
    ]);
    expect(record.classification.relatedCategories).toEqual([]);
    const plan = migratePlan({ version: 1, actions: [{ id: 'x' }] });
    expect(plan?.version).toBe(2);
    expect(plan?.actions[0].kind).toBe('move');
  });
});
