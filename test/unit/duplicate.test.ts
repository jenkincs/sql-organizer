import { describe, expect, it } from 'vitest';
import { assignExactDuplicateGroups } from '../../src/duplicate/exactDuplicateDetector';
import { SqlInventoryItem } from '../../src/domain/models';
const item = (id: string, hash: string) => ({ id, normalizedHash: hash } as SqlInventoryItem);
describe('exact duplicate detector', () => it('groups same normalized SQL without deleting anything', () => { const items = [item('a', 'x'), item('b', 'x'), item('c', 'y')]; assignExactDuplicateGroups(items); expect(items[0].exactDuplicateGroupId).toBe(items[1].exactDuplicateGroupId); expect(items[2].exactDuplicateGroupId).toBeUndefined(); }));
