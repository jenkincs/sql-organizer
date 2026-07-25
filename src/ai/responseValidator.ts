import { z } from 'zod';
import { SqlOperation } from '../domain/models';

const operations = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'DDL', 'PLSQL', 'UNKNOWN'] as const;
const risks = ['read-only', 'write', 'schema-change', 'dynamic', 'unknown'] as const;

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function filename(value: unknown): string {
  const base =
    (typeof value === 'string' ? value : 'unnamed')
      .toLowerCase()
      .replace(/\.sql$/i, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 76) || 'unnamed';
  return `${base}.sql`;
}

function operation(value: unknown, fallback: SqlOperation): (typeof operations)[number] {
  const normalized =
    typeof value === 'string'
      ? value
          .trim()
          .toUpperCase()
          .replace(/[\s_-]+/g, '')
      : '';
  if (operations.includes(normalized as (typeof operations)[number])) return normalized as (typeof operations)[number];
  if (['CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'GRANT', 'REVOKE'].includes(normalized)) return 'DDL';
  if (['BEGIN', 'CALL', 'EXEC', 'EXECUTE'].includes(normalized)) return 'PLSQL';
  return fallback;
}

/** Normalizes common provider/model variants before applying the strict persisted schema. */
export function normalizeClassificationResponse(value: unknown, fallbackOperation: SqlOperation): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const raw = value as Record<string, unknown>;
  const normalizedOperation = operation(raw.operation, fallbackOperation);
  const rawRisk = typeof raw.risk === 'string' ? raw.risk.trim().toLowerCase() : '';
  const risk = risks.includes(rawRisk as (typeof risks)[number]) ? rawRisk : 'unknown';
  const riskReasons = stringArray(raw.riskReasons);
  if (rawRisk && risk === 'unknown' && rawRisk !== 'unknown')
    riskReasons.push(`AI returned unsupported risk value "${rawRisk}"; treated as unknown for safety.`);
  const confidence =
    typeof raw.confidence === 'number' ? Math.min(1, Math.max(0, raw.confidence)) : Number(raw.confidence);
  return {
    category: typeof raw.category === 'string' ? raw.category.trim() : raw.category,
    operation: normalizedOperation,
    dialect:
      typeof raw.dialect === 'string'
        ? ({ postgresql: 'postgresql', postgres: 'postgresql', mssql: 'sqlserver' }[raw.dialect.trim().toLowerCase()] ??
          raw.dialect.trim().toLowerCase())
        : raw.dialect,
    purpose: typeof raw.purpose === 'string' ? raw.purpose.trim() : raw.purpose,
    suggestedFilename: filename(raw.suggestedFilename),
    tables: stringArray(raw.tables),
    parameters: stringArray(raw.parameters),
    risk,
    riskReasons,
    confidence,
    reviewNotes: stringArray(raw.reviewNotes),
  };
}

export const classificationSchema = z
  .object({
    category: z.string().min(1),
    operation: z.enum(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'DDL', 'PLSQL', 'UNKNOWN']),
    dialect: z.enum(['oracle', 'postgresql', 'mysql', 'sqlserver', 'sqlite', 'generic', 'unknown']),
    purpose: z.string().max(1000),
    suggestedFilename: z.string().regex(/^[a-z0-9][a-z0-9-]*\.sql$/),
    tables: z.array(z.string()),
    parameters: z.array(z.string()),
    risk: z.enum(['read-only', 'write', 'schema-change', 'dynamic', 'unknown']),
    riskReasons: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    reviewNotes: z.array(z.string()),
  })
  .strict();
