import { z } from 'zod';
import { SqlOperation } from '../domain/models';

const operations = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'DDL', 'PLSQL', 'UNKNOWN'] as const;
const risks = ['read-only', 'write', 'schema-change', 'dynamic', 'unknown'] as const;

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function portableSlug(value: unknown, fallback = 'unknown'): string {
  return (
    (typeof value === 'string' ? value : fallback)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || fallback
  );
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

function confidence(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.min(1, Math.max(0, value));
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    const levels: Record<string, number> = { low: 0.4, medium: 0.65, high: 0.85 };
    if (normalized in levels) return levels[normalized];
    const numeric = Number(normalized.replace(/%$/, ''));
    if (Number.isFinite(numeric)) return Math.min(1, Math.max(0, normalized.endsWith('%') ? numeric / 100 : numeric));
  }
  // Unknown confidence must never enable auto-approval.
  return 0.5;
}

/** Normalizes common provider/model variants before applying the strict persisted schema. */
export function normalizeClassificationResponse(
  value: unknown,
  fallbackOperation: SqlOperation,
  knownCategories: string[] = [],
): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const raw = value as Record<string, unknown>;
  const normalizedOperation = operation(raw.operation, fallbackOperation);
  const rawRisk = typeof raw.risk === 'string' ? raw.risk.trim().toLowerCase() : '';
  const risk = risks.includes(rawRisk as (typeof risks)[number]) ? rawRisk : 'unknown';
  const riskReasons = stringArray(raw.riskReasons);
  if (rawRisk && risk === 'unknown' && rawRisk !== 'unknown')
    riskReasons.push(`AI returned unsupported risk value "${rawRisk}"; treated as unknown for safety.`);
  const category = portableSlug(raw.category);
  const relatedCategories = [
    ...new Set(
      stringArray(raw.relatedCategories)
        .map((item) => portableSlug(item))
        .filter((item) => item !== category),
    ),
  ];
  const rawDecision = typeof raw.taxonomyDecision === 'string' ? raw.taxonomyDecision.toLowerCase() : '';
  const taxonomyDecision =
    rawDecision === 'existing' || rawDecision === 'proposed' || rawDecision === 'unknown'
      ? rawDecision
      : knownCategories.includes(category)
        ? 'existing'
        : category === 'unknown'
          ? 'unknown'
          : 'proposed';
  return {
    category,
    operation: normalizedOperation,
    dialect:
      typeof raw.dialect === 'string'
        ? ({
            postgresql: 'postgresql',
            postgres: 'postgresql',
            postgis: 'postgresql',
            plpgsql: 'postgresql',
            mssql: 'sqlserver',
          }[raw.dialect.trim().toLowerCase()] ?? raw.dialect.trim().toLowerCase())
        : raw.dialect,
    purpose: typeof raw.purpose === 'string' ? raw.purpose.trim() : raw.purpose,
    suggestedFilename: filename(raw.suggestedFilename),
    tables: stringArray(raw.tables),
    parameters: stringArray(raw.parameters),
    risk,
    riskReasons,
    confidence: confidence(raw.confidence),
    reviewNotes: stringArray(raw.reviewNotes),
    relatedCategories,
    taxonomyDecision,
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
    relatedCategories: z.array(z.string()).default([]),
    taxonomyDecision: z.enum(['existing', 'proposed', 'unknown']).default('existing'),
  })
  .strict();
