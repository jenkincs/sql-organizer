import { ClassificationRecord, OrganizerPlan, SqlInventoryItem } from '../domain/models';

export function migrateInventory(value: unknown): SqlInventoryItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const item = raw as SqlInventoryItem;
    return {
      ...item,
      unitKind: item.unitKind ?? 'file',
      sourceFileUri: item.sourceFileUri ?? item.uri,
      sourceFileRelativePath: item.sourceFileRelativePath ?? item.relativePath,
      sourceFileRawHash: item.sourceFileRawHash ?? item.rawHash,
      splitSafety: item.splitSafety ?? 'keep-together',
    };
  });
}

export function migrateClassifications(value: unknown): ClassificationRecord[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const record = raw as ClassificationRecord;
    return {
      ...record,
      classification: {
        ...record.classification,
        relatedCategories: record.classification.relatedCategories ?? [],
        taxonomyDecision: record.classification.taxonomyDecision ?? 'existing',
      },
    };
  });
}

export function migratePlan(value: unknown): OrganizerPlan | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const plan = value as OrganizerPlan;
  if (!Array.isArray(plan.actions)) return undefined;
  return {
    ...plan,
    version: 2,
    actions: plan.actions.map((action) => ({
      ...action,
      kind: action.kind ?? 'move',
      sourceUnitId: action.sourceUnitId ?? action.id,
    })),
    taxonomyProposals: plan.taxonomyProposals ?? [],
  };
}
