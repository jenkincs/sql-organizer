export type SqlOperation = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'MERGE' | 'DDL' | 'PLSQL' | 'UNKNOWN';
export type SqlDialect = 'oracle' | 'postgresql' | 'mysql' | 'sqlserver' | 'sqlite' | 'generic' | 'unknown';
export type SqlRisk = 'read-only' | 'write' | 'schema-change' | 'dynamic' | 'unknown';
export type SqlUnitKind = 'file' | 'statement';
export type TaxonomyDecision = 'existing' | 'proposed' | 'unknown';
export type PlanActionKind = 'move' | 'extract' | 'archive' | 'create-category';
export interface SqlInventoryItem {
  id: string;
  uri: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAt: number;
  rawHash: string;
  normalizedHash: string;
  normalizedTokens: string[];
  operation: SqlOperation;
  dialectHint: SqlDialect;
  tables: string[];
  parameters: string[];
  warnings: string[];
  exactDuplicateGroupId?: string;
  classificationStatus: 'not-analyzed' | 'analyzed' | 'analysis-error' | 'stale';
  classificationError?: { message: string; retryable: boolean; occurredAt: string };
  unitKind?: SqlUnitKind;
  sourceFileUri?: string;
  sourceFileRelativePath?: string;
  sourceFileRawHash?: string;
  statementIndex?: number;
  startLine?: number;
  endLine?: number;
  splitSafety?: 'safe' | 'keep-together' | 'ambiguous';
}
export interface SqlClassification {
  category: string;
  operation: SqlOperation;
  dialect: SqlDialect;
  purpose: string;
  suggestedFilename: string;
  tables: string[];
  parameters: string[];
  risk: SqlRisk;
  riskReasons: string[];
  confidence: number;
  reviewNotes: string[];
  relatedCategories?: string[];
  taxonomyDecision?: TaxonomyDecision;
}
export interface ClassificationRecord {
  itemId: string;
  cacheKey: string;
  classification: SqlClassification;
  analyzedAt: string;
}
export interface SimilarityCandidate {
  leftId: string;
  rightId: string;
  score: number;
  reason: string;
}
export interface TaxonomyEntry {
  slug: string;
  label: string;
  source: 'configured' | 'discovered' | 'approved';
  examples: { relativePath: string; purpose: string; tables: string[] }[];
  createdAt: string;
}
export interface TaxonomyState {
  version: 1;
  entries: TaxonomyEntry[];
  updatedAt: string;
}
export interface TaxonomyProposal {
  slug: string;
  label: string;
  reason: string;
  actionId?: string;
}
export interface PlanAction {
  id: string;
  sourceUri: string;
  sourceRelativePath: string;
  sourceRawHash: string;
  proposedCategory: string;
  proposedOperationFolder: string;
  proposedFilename: string;
  proposedDestination: string;
  finalCategory: string;
  finalOperationFolder: string;
  finalFilename: string;
  finalDestination: string;
  reason: string;
  confidence: number;
  risk: SqlRisk;
  exactDuplicateOf?: string;
  status: 'pending' | 'approved' | 'rejected' | 'conflict' | 'applied' | 'failed';
  userModified: boolean;
  userNote?: string;
  validationErrors: string[];
  kind?: PlanActionKind;
  sourceUnitId?: string;
  sourceStartLine?: number;
  sourceEndLine?: number;
  content?: string;
  archiveSource?: boolean;
  taxonomyProposal?: TaxonomyProposal;
}
export interface OrganizerPlan {
  version: 1 | 2;
  id: string;
  rootUri: string;
  createdAt: string;
  inventoryVersion: string;
  configHash: string;
  actions: PlanAction[];
  similarityCandidates: SimilarityCandidate[];
  warnings: string[];
  status: 'draft' | 'reviewing' | 'ready' | 'partially-applied' | 'applied' | 'stale';
  taxonomyProposals?: TaxonomyProposal[];
}
