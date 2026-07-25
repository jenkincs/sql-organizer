import * as vscode from 'vscode';
import { z } from 'zod';
import YAML from 'yaml';

const configSchema = z.object({
  version: z.literal(1).default(1),
  root: z
    .object({
      include: z.array(z.string()).default(['**/*.sql']),
      exclude: z
        .array(z.string())
        .default(['.git/**', '.sql-organizer/**', 'node_modules/**', 'duplicates/**', 'archive/**']),
      inbox: z.array(z.string()).default(['inbox/**']),
      maxFileBytes: z.number().int().positive().default(300000),
    })
    .default({}),
  taxonomy: z
    .object({
      categories: z
        .array(z.string().min(1))
        .default(['customer', 'booking', 'invoice', 'access', 'login', 'reporting', 'operations', 'system', 'unknown']),
      operationFolders: z.record(z.string()).default({
        SELECT: 'query',
        INSERT: 'dml',
        UPDATE: 'dml',
        DELETE: 'dml',
        MERGE: 'dml',
        DDL: 'ddl',
        PLSQL: 'plsql',
        UNKNOWN: 'unknown',
      }),
    })
    .default({}),
  rules: z
    .object({
      tableMappings: z.record(z.string()).default({}),
      tablePrefixMappings: z.record(z.string()).default({}),
      pathMappings: z.record(z.string()).default({}),
      keywordMappings: z.record(z.string()).default({}),
    })
    .default({}),
  classification: z
    .object({
      lowConfidenceThreshold: z.number().min(0).max(1).default(0.7),
      autoApproveThreshold: z.number().min(0).max(1).default(0.95),
      enableAutoApprove: z.boolean().default(false),
      unknownCategory: z.string().default('unknown'),
      unclassifiedFolder: z.string().default('unclassified'),
    })
    .default({}),
  duplicates: z
    .object({
      detectExact: z.boolean().default(true),
      normalizeLiterals: z.boolean().default(true),
      candidateThreshold: z.number().min(0).max(1).default(0.72),
      semanticThreshold: z.number().min(0).max(1).default(0.9),
      exactFolder: z.string().default('duplicates/exact'),
      neverDelete: z.literal(true).default(true),
    })
    .default({}),
  naming: z
    .object({
      style: z.literal('kebab-case').default('kebab-case'),
      maxLength: z.number().int().positive().default(80),
      includePrimaryTable: z.boolean().default(false),
    })
    .default({}),
  ai: z
    .object({
      provider: z.literal('openai').default('openai'),
      model: z.string().default(''),
      models: z.array(z.string().trim().min(1)).default([]),
      baseUrl: z.string().default(''),
      apiProtocol: z.enum(['responses', 'chat-completions']).default('responses'),
      batchSize: z.number().int().positive().default(5),
      concurrency: z.number().int().positive().default(2),
      timeoutMs: z.number().int().positive().default(60000),
      maxRetries: z.number().int().nonnegative().default(2),
      redactBeforeSend: z.boolean().default(true),
      maxSqlChars: z.number().int().positive().default(12000),
      sendComments: z.boolean().default(true),
      customSystemPrompt: z.string().default(''),
      customClassificationPrompt: z.string().default(''),
    })
    .default({}),
  safety: z
    .object({
      dryRunByDefault: z.literal(true).default(true),
      requireGitRepository: z.boolean().default(false),
      requireCleanGitForApply: z.boolean().default(true),
      neverOverwrite: z.literal(true).default(true),
      verifySourceHashBeforeApply: z.literal(true).default(true),
      allowOutsideWorkspace: z.literal(false).default(false),
      allowSymlinks: z.literal(false).default(false),
    })
    .default({}),
  output: z
    .object({
      stateFolder: z.string().default('.sql-organizer'),
      inventoryFile: z.string().default('inventory.json'),
      classificationsFile: z.string().default('classifications.json'),
      planFile: z.string().default('plan.json'),
      reportFile: z.string().default('SQL-ORGANIZER-REPORT.md'),
      indexFile: z.string().default('INDEX.md'),
      manifestFolder: z.string().default('manifests'),
    })
    .default({}),
});
export type OrganizerConfig = z.infer<typeof configSchema>;
export const defaultConfig: OrganizerConfig = configSchema.parse({});
export const configFileName = 'sql-organizer.config.yml';
export async function loadConfig(root: vscode.Uri): Promise<OrganizerConfig> {
  const uri = vscode.Uri.joinPath(root, configFileName);
  try {
    return configSchema.parse(YAML.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')));
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return defaultConfig;
    throw new Error(`Invalid ${configFileName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
export async function writeDefaultConfig(root: vscode.Uri): Promise<vscode.Uri> {
  const uri = vscode.Uri.joinPath(root, configFileName);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(YAML.stringify(defaultConfig), 'utf8'));
  return uri;
}
export async function saveConfig(root: vscode.Uri, config: OrganizerConfig): Promise<void> {
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(root, configFileName),
    Buffer.from(YAML.stringify(configSchema.parse(config)), 'utf8'),
  );
}
