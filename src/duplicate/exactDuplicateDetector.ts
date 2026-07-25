import { SqlInventoryItem } from '../domain/models';
export function assignExactDuplicateGroups(items: SqlInventoryItem[]): void {
  const groups = new Map<string, SqlInventoryItem[]>();
  items.forEach((item) => groups.set(item.normalizedHash, [...(groups.get(item.normalizedHash) ?? []), item]));
  for (const [hash, members] of groups)
    if (members.length > 1)
      members.forEach((member) => {
        member.exactDuplicateGroupId = `exact-${hash.slice(0, 12)}`;
      });
}
