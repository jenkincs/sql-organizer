import * as vscode from 'vscode';
import { z } from 'zod';
import { OrganizerConfig } from '../config/config';

const schema = z.object({ version: z.literal(1), baseUrl: z.string(), apiProtocol: z.enum(['responses', 'chat-completions']), models: z.array(z.string().trim().min(1)) });
export type LlmSettings = z.infer<typeof schema>;
export class LlmSettingsStore {
  constructor(private readonly folder: vscode.Uri) {}
  private get uri(): vscode.Uri { return vscode.Uri.joinPath(this.folder, 'llm-settings.json'); }
  private fallback(config: OrganizerConfig): LlmSettings { return { version: 1, baseUrl: config.ai.baseUrl, apiProtocol: config.ai.apiProtocol, models: config.ai.models.length ? config.ai.models : [config.ai.model].filter(Boolean) }; }
  async get(config: OrganizerConfig): Promise<LlmSettings> { try { return schema.parse(JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(this.uri)).toString('utf8'))); } catch { const migrated = this.fallback(config); if (migrated.baseUrl || migrated.models.length) await this.save(migrated); return migrated; } }
  async save(value: LlmSettings): Promise<void> { await vscode.workspace.fs.createDirectory(this.folder); await vscode.workspace.fs.writeFile(this.uri, Buffer.from(JSON.stringify(schema.parse(value), null, 2), 'utf8')); }
}
