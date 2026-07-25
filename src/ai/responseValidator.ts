import { z } from 'zod';
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
