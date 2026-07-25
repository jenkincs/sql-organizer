import { describe, expect, it } from 'vitest';
import { classificationSchema, normalizeClassificationResponse } from '../../src/ai/responseValidator';
import { retryableAiError, safeAiErrorMessage } from '../../src/ai/classificationRecovery';
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
          dialect: 'Postgres',
          purpose: 'Grant reporting access',
          suggestedFilename: 'Grant Reporting Access.SQL',
          tables: [],
          parameters: [],
          risk: 'medium',
          riskReasons: [],
          confidence: 'high',
          reviewNotes: [],
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
    expect(normalized.riskReasons[0]).toContain('unsupported risk value');
  });
});
