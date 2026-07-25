import { describe, expect, it } from 'vitest';
import { sanitizeFilename } from '../../src/planning/filenameSanitizer';
import { buildPlan } from '../../src/planning/planBuilder';
import { SqlInventoryItem } from '../../src/domain/models';
import type { OrganizerConfig } from '../../src/config/config';

const config = {
  classification: { lowConfidenceThreshold: 0.7, unclassifiedFolder: 'unclassified' },
  taxonomy: { mode: 'adaptive', allowNewCategories: true, operationFolders: { SELECT: 'query' } },
  duplicates: { exactFolder: 'duplicates/exact', candidateThreshold: 0.72 },
  naming: { maxLength: 80 },
  splitting: { archiveOriginalAfterSplit: false },
  organization: { moduleFolder: 'modules' },
} as unknown as OrganizerConfig;
describe('filename safety', () => {
  it('makes a portable kebab case filename', () => expect(sanitizeFilename('../CON.sql', 80)).toBe('con-sql.sql'));
});

describe('adaptive unit planning', () => {
  it('creates an extraction action and a new-category proposal for a safe SQL statement', () => {
    const item: SqlInventoryItem = {
      id: 'statement',
      uri: 'file:///workspace/mixed.sql',
      relativePath: 'mixed.sql#L2-L2',
      sourceFileUri: 'file:///workspace/mixed.sql',
      sourceFileRelativePath: 'mixed.sql',
      sourceFileRawHash: 'source',
      rawHash: 'statement',
      normalizedHash: 'statement',
      normalizedTokens: [],
      sizeBytes: 1,
      modifiedAt: 1,
      operation: 'SELECT',
      dialectHint: 'generic',
      tables: [],
      parameters: [],
      warnings: [],
      classificationStatus: 'analyzed',
      unitKind: 'statement',
      statementIndex: 1,
      startLine: 2,
      endLine: 2,
      splitSafety: 'safe',
    };
    const plan = buildPlan(
      'file:///workspace',
      'config',
      config,
      [item],
      [
        {
          itemId: 'statement',
          cacheKey: 'key',
          analyzedAt: 'now',
          classification: {
            category: 'audit-log',
            taxonomyDecision: 'proposed',
            relatedCategories: [],
            operation: 'SELECT',
            dialect: 'generic',
            purpose: 'Read audit events',
            suggestedFilename: 'read-audit-events.sql',
            tables: [],
            parameters: [],
            risk: 'read-only',
            riskReasons: [],
            confidence: 0.9,
            reviewNotes: [],
          },
        },
      ],
      { version: 1, entries: [], updatedAt: 'now' },
    );
    expect(plan.version).toBe(2);
    expect(plan.actions[0].kind).toBe('append');
    expect(plan.actions[0].finalDestination).toBe('modules/audit-log.sql');
    expect(plan.taxonomyProposals?.[0].slug).toBe('audit-log');
  });
});
