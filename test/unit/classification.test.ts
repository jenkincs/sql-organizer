import { describe, expect, it } from 'vitest';
import { classificationSchema, normalizeClassificationResponse } from '../../src/ai/responseValidator';
import { retryableAiError, safeAiErrorMessage } from '../../src/ai/classificationRecovery';
import { bindClassificationToItem } from '../../src/ai/classificationCache';
describe('classification schema', () =>
  it('rejects unsafe filenames and invalid responses', () => {
    expect(() =>
      classificationSchema.parse({
        category: 'unknown',
        operation: 'SELECT',
        dialect: 'generic',
        purpose: 'x',
        suggestedFilename: '../x.sql',
        tables: [],
        parameters: [],
        risk: 'read-only',
        riskReasons: [],
        confidence: 1,
        reviewNotes: [],
      }),
    ).toThrow();
  }));

describe('classification recovery', () => {
  it('retries transient provider errors but not invalid requests', () => {
    expect(retryableAiError({ status: 429 })).toBe(true);
    expect(retryableAiError({ status: 500 })).toBe(true);
    expect(retryableAiError({ status: 401 })).toBe(false);
    expect(retryableAiError(new Error('network timeout'))).toBe(true);
  });
  it('keeps persisted errors concise and redacts key-shaped values', () => {
    expect(safeAiErrorMessage(new Error('Request rejected sk-abcdefghijklmnopqrstuvwxyz123456'))).toContain(
      '[redacted]',
    );
  });
});

describe('classification response normalization', () => {
  it('normalizes common model variants without weakening persisted safety values', () => {
    const normalized = classificationSchema.parse(
      normalizeClassificationResponse(
        {
          category: 'reporting',
          operation: 'GRANT',
          dialect: 'plpgsql',
          purpose: 'Grant reporting access',
          suggestedFilename: 'Grant Reporting Access.SQL',
          tables: [],
          parameters: [],
          risk: 'medium',
          riskReasons: [],
          confidence: 'high',
          reviewNotes: [],
          relatedCategories: ['access control'],
          taxonomyDecision: 'proposed',
          providerSpecificField: true,
        },
        'UNKNOWN',
      ),
    );
    expect(normalized.operation).toBe('DDL');
    expect(normalized.dialect).toBe('postgresql');
    expect(normalized.risk).toBe('unknown');
    expect(normalized.suggestedFilename).toBe('grant-reporting-access.sql');
    expect(normalized.confidence).toBe(0.85);
    expect(normalized.relatedCategories).toEqual(['access-control']);
    expect(normalized.taxonomyDecision).toBe('proposed');
    expect(normalized.riskReasons[0]).toContain('unsupported risk value');
  });
});

describe('classification cache relocation', () => {
  it('rebinds a content-cached classification when its workspace path changes', () => {
    const records = [
      {
        itemId: 'old-absolute-path-id',
        cacheKey: 'same-sql-content',
        analyzedAt: '2026-07-25T00:00:00.000Z',
        classification: {
          category: 'customer',
          operation: 'SELECT' as const,
          dialect: 'generic' as const,
          purpose: 'Find customer',
          suggestedFilename: 'find-customer.sql',
          tables: ['customers'],
          parameters: [],
          risk: 'read-only' as const,
          riskReasons: [],
          confidence: 0.9,
          reviewNotes: [],
        },
      },
    ];
    bindClassificationToItem(records, records[0], 'new-absolute-path-id');
    expect(records.find((record) => record.itemId === 'new-absolute-path-id')?.classification.purpose).toBe(
      'Find customer',
    );
  });
});
