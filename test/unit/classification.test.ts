import { describe, expect, it } from 'vitest';
import { classificationSchema } from '../../src/ai/responseValidator';
describe('classification schema', () => it('rejects unsafe filenames and invalid responses', () => { expect(() => classificationSchema.parse({ category: 'unknown', operation: 'SELECT', dialect: 'generic', purpose: 'x', suggestedFilename: '../x.sql', tables: [], parameters: [], risk: 'read-only', riskReasons: [], confidence: 1, reviewNotes: [] })).toThrow(); }));
