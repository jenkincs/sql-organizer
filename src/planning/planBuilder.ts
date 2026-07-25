import { OrganizerConfig } from '../config/config';
import { ClassificationRecord, OrganizerPlan, PlanAction, SqlInventoryItem, TaxonomyState } from '../domain/models';
import { findSimilarities } from '../duplicate/similarityDetector';
import { sanitizeFilename } from './filenameSanitizer';
import { proposeCategory } from '../taxonomy/taxonomyService';
export function buildPlan(
  rootUri: string,
  configHash: string,
  config: OrganizerConfig,
  items: SqlInventoryItem[],
  records: ClassificationRecord[],
  taxonomy?: TaxonomyState,
): OrganizerPlan {
  const byId = new Map(records.map((x) => [x.itemId, x.classification]));
  const destinations = new Set<string>();
  const taxonomyProposals = new Map<string, NonNullable<OrganizerPlan['taxonomyProposals']>[number]>();
  const actions: PlanAction[] = items
    .filter((item) => byId.has(item.id))
    .map((item) => {
      const c = byId.get(item.id)!;
      const low = c.confidence < config.classification.lowConfidenceThreshold;
      const category = low ? config.classification.unclassifiedFolder : c.category;
      const proposal =
        config.taxonomy.mode === 'adaptive' &&
        config.taxonomy.allowNewCategories &&
        c.taxonomyDecision === 'proposed' &&
        taxonomy
          ? proposeCategory(category, c.purpose, taxonomy)
          : undefined;
      if (proposal) taxonomyProposals.set(proposal.slug, proposal);
      const op = config.taxonomy.operationFolders[c.operation] ?? 'unknown';
      const filename = sanitizeFilename(c.suggestedFilename, config.naming.maxLength);
      let destination = item.exactDuplicateGroupId
        ? `${config.duplicates.exactFolder}/${category}/${filename}`
        : `${category}/${op}/${filename}`;
      let status: PlanAction['status'] = 'pending';
      const errors: string[] = [];
      if (destinations.has(destination)) {
        status = 'conflict';
        errors.push('duplicate-destination');
      }
      destinations.add(destination);
      if (destination === item.relativePath) errors.push('no-op');
      return {
        id: item.id,
        sourceUri: item.sourceFileUri ?? item.uri,
        sourceRelativePath: item.sourceFileRelativePath ?? item.relativePath,
        sourceRawHash: item.sourceFileRawHash ?? item.rawHash,
        proposedCategory: category,
        proposedOperationFolder: op,
        proposedFilename: filename,
        proposedDestination: destination,
        finalCategory: category,
        finalOperationFolder: op,
        finalFilename: filename,
        finalDestination: destination,
        reason: item.exactDuplicateGroupId
          ? 'Exact duplicate; quarantined, never deleted.'
          : low
            ? 'Low confidence requires review.'
            : c.purpose,
        confidence: c.confidence,
        risk: c.risk,
        exactDuplicateOf: item.exactDuplicateGroupId,
        status,
        userModified: false,
        validationErrors: errors,
        kind: item.unitKind === 'statement' ? 'extract' : 'move',
        sourceUnitId: item.id,
        sourceStartLine: item.startLine,
        sourceEndLine: item.endLine,
        sourceStatementIndex: item.statementIndex,
        archiveSource: item.unitKind === 'statement' && config.splitting.archiveOriginalAfterSplit,
        taxonomyProposal: proposal,
      };
    });
  return {
    version: 2,
    id: crypto.randomUUID(),
    rootUri,
    createdAt: new Date().toISOString(),
    inventoryVersion: String(Math.max(0, ...items.map((x) => x.modifiedAt))),
    configHash,
    actions,
    similarityCandidates: findSimilarities(items, config.duplicates.candidateThreshold),
    warnings: [
      'Plan is a dry run. Similar SQL is never moved or merged automatically.',
      'Statement extraction never deletes the original source unless an approved archive action is enabled.',
    ],
    status: 'reviewing',
    taxonomyProposals: [...taxonomyProposals.values()],
  };
}
