import { describe, expect, it } from 'vitest';
import { buildTaxonomyState, proposeCategory, taxonomyPromptContext } from '../../src/taxonomy/taxonomyService';
import { ClassificationRecord, OrganizerPlan, SqlInventoryItem } from '../../src/domain/models';

describe('adaptive taxonomy', () => {
  it('combines configured, discovered, and approved categories with bounded examples', () => {
    const state = buildTaxonomyState(
      ['customer'],
      undefined,
      [
        { id: '1', relativePath: 'audit/query/events.sql' },
        { id: '2', relativePath: 'customer/query/find.sql' },
      ] as unknown as SqlInventoryItem[],
      [
        {
          itemId: '2',
          classification: { category: 'customer', purpose: 'Find customer', tables: ['customers'] },
        },
      ] as unknown as ClassificationRecord[],
      { actions: [{ id: '2', status: 'applied' }] } as unknown as OrganizerPlan,
      '2026-01-01T00:00:00.000Z',
    );
    expect(state.entries.map((entry) => entry.slug)).toEqual(['audit', 'customer']);
    expect(taxonomyPromptContext(state, 1).examples[0].purpose).toBe('Find customer');
  });
  it('proposes a portable category only when it is new', () => {
    const state = { version: 1 as const, entries: [], updatedAt: 'now' };
    expect(proposeCategory('Audit Logs', 'No current category fits', state)?.slug).toBe('audit-logs');
    expect(proposeCategory('unknown', 'fallback', state)).toBeUndefined();
  });
});
