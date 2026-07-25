import { describe, expect, it } from 'vitest';
import { OpenAiProvider, normalizeBaseUrl } from '../../src/ai/openAiProvider';

const valid = { category: 'unknown', operation: 'SELECT', dialect: 'generic', purpose: 'Test', suggestedFilename: 'test.sql', tables: [], parameters: [], risk: 'read-only', riskReasons: [], confidence: .5, reviewNotes: [] };
const input = { relativePath: 'test.sql', sizeBytes: 1, operation: 'SELECT' as const, dialectHint: 'generic' as const, tables: [], parameters: [], redactedSql: 'SELECT 1', categories: ['unknown'] };

describe('OpenAI endpoint support', () => {
  it('normalizes safe base URLs and rejects unsafe forms', () => { expect(normalizeBaseUrl('https://llm.example.test/v1/')).toBe('https://llm.example.test/v1'); expect(() => normalizeBaseUrl('https://key@llm.example.test/v1')).toThrow(); expect(() => normalizeBaseUrl('https://llm.example.test/v1?token=x')).toThrow(); });
  it('uses Responses output_text with storage disabled', async () => { let request: unknown; const client = { responses: { create: async (value: unknown) => { request = value; return { output_text: JSON.stringify(valid) }; } } } as unknown; const provider = new OpenAiProvider({ apiKey: 'test', model: 'model', timeoutMs: 1, protocol: 'responses' }, client as never); await expect(provider.classify(input)).resolves.toMatchObject(valid); expect(request).toMatchObject({ model: 'model', store: false, text: { format: { type: 'json_object' } } }); });
  it('uses Chat Completions when explicitly selected', async () => { let request: unknown; const client = { chat: { completions: { create: async (value: unknown) => { request = value; return { choices: [{ message: { content: JSON.stringify(valid) } }] }; } } } } as unknown; const provider = new OpenAiProvider({ apiKey: 'test', model: 'model', timeoutMs: 1, protocol: 'chat-completions' }, client as never); await expect(provider.classify(input)).resolves.toMatchObject(valid); expect(request).toMatchObject({ response_format: { type: 'json_object' } }); });
});
