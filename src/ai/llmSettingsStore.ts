import * as vscode from 'vscode';
import { z } from 'zod';
import { OrganizerConfig } from '../config/config';

const profileSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string(),
  apiProtocol: z.enum(['responses', 'chat-completions']),
  models: z.array(z.string().trim().min(1)),
});
const schema = z.object({
  version: z.literal(2),
  activeProfileId: z.string(),
  profiles: z.array(profileSchema).min(1),
});
type LegacySettings = { version: 1; baseUrl: string; apiProtocol: 'responses' | 'chat-completions'; models: string[] };
export type LlmProfile = z.infer<typeof profileSchema>;
export type LlmSettings = z.infer<typeof schema>;
export const profileSecretKey = (profileId: string): string => `sqlOrganizer.llmProfile.${profileId}.apiKey`;
const profileId = (name: string): string =>
  `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'endpoint'
  }-${crypto.randomUUID().slice(0, 8)}`;
export class LlmSettingsStore {
  constructor(private readonly folder: vscode.Uri) {}
  private get uri(): vscode.Uri {
    return vscode.Uri.joinPath(this.folder, 'llm-settings.json');
  }
  private fallback(config: OrganizerConfig): LlmSettings {
    const legacy: LegacySettings = {
      version: 1,
      baseUrl: config.ai.baseUrl,
      apiProtocol: config.ai.apiProtocol,
      models: config.ai.models.length ? config.ai.models : [config.ai.model].filter(Boolean),
    };
    const profile: LlmProfile = {
      id: profileId('default'),
      name: 'Default endpoint',
      baseUrl: legacy.baseUrl,
      apiProtocol: legacy.apiProtocol,
      models: legacy.models,
    };
    return { version: 2, activeProfileId: profile.id, profiles: [profile] };
  }
  async get(config: OrganizerConfig): Promise<LlmSettings> {
    try {
      const parsed = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(this.uri)).toString('utf8'));
      if (parsed.version === 1) {
        const legacy = parsed as LegacySettings;
        const profile: LlmProfile = {
          id: profileId('default'),
          name: 'Default endpoint',
          baseUrl: legacy.baseUrl,
          apiProtocol: legacy.apiProtocol,
          models: legacy.models,
        };
        const migrated: LlmSettings = { version: 2, activeProfileId: profile.id, profiles: [profile] };
        await this.save(migrated);
        return migrated;
      }
      return schema.parse(parsed);
    } catch {
      const migrated = this.fallback(config);
      if (migrated.profiles[0].baseUrl || config.ai.models.length || config.ai.model) await this.save(migrated);
      return migrated;
    }
  }
  async save(value: LlmSettings): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.folder);
    await vscode.workspace.fs.writeFile(this.uri, Buffer.from(JSON.stringify(schema.parse(value), null, 2), 'utf8'));
  }
  active(settings: LlmSettings): LlmProfile {
    return settings.profiles.find((profile) => profile.id === settings.activeProfileId) ?? settings.profiles[0];
  }
}
