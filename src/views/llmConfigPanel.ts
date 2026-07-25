import * as vscode from 'vscode';
import { z } from 'zod';
import { loadConfig } from '../config/config';
import { OpenAiProvider } from '../ai/openAiProvider';
import { LlmProfile, LlmSettings, LlmSettingsStore, profileSecretKey } from '../ai/llmSettingsStore';

const message = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('save'),
    baseUrl: z.string(),
    protocol: z.enum(['responses', 'chat-completions']),
    models: z.string(),
    apiKey: z.string().optional(),
  }),
  z.object({
    type: z.literal('test'),
    baseUrl: z.string(),
    protocol: z.enum(['responses', 'chat-completions']),
    models: z.string(),
    model: z.string(),
    apiKey: z.string().optional(),
  }),
  z.object({ type: z.literal('selectProfile'), id: z.string() }),
  z.object({ type: z.literal('addProfile'), name: z.string().trim().min(1).max(80) }),
  z.object({ type: z.literal('deleteProfile') }),
]);
export class LlmConfigPanel {
  static async open(context: vscode.ExtensionContext, root: vscode.Uri): Promise<void> {
    const store = new LlmSettingsStore(context.globalStorageUri);
    const panel = vscode.window.createWebviewPanel(
      'sqlOrganizer.llmConfig',
      'SQL Organizer: LLM Configuration',
      vscode.ViewColumn.One,
      { enableScripts: true },
    );
    const render = async (notice = '') => {
      const settings = await store.get(await loadConfig(root));
      panel.webview.html = html(settings, store.active(settings), notice);
    };
    panel.webview.onDidReceiveMessage(
      async (raw: unknown) => {
        const parsed = message.safeParse(raw);
        if (!parsed.success) return void vscode.window.showErrorMessage('Rejected invalid LLM configuration message.');
        const value = parsed.data;
        const settings = await store.get(await loadConfig(root));
        const active = store.active(settings);
        if (value.type === 'selectProfile') {
          if (settings.profiles.some((p) => p.id === value.id))
            await store.save({ ...settings, activeProfileId: value.id });
          return void render();
        }
        if (value.type === 'addProfile') {
          const id = `${
            value.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '') || 'endpoint'
          }-${crypto.randomUUID().slice(0, 8)}`;
          await store.save({
            ...settings,
            activeProfileId: id,
            profiles: [
              ...settings.profiles,
              { id, name: value.name, baseUrl: '', apiProtocol: 'responses', models: [] },
            ],
          });
          return void render('New endpoint profile added.');
        }
        if (value.type === 'deleteProfile') {
          if (settings.profiles.length === 1) return void render('At least one endpoint profile is required.');
          await context.secrets.delete(profileSecretKey(active.id));
          const profiles = settings.profiles.filter((p) => p.id !== active.id);
          await store.save({ ...settings, activeProfileId: profiles[0].id, profiles });
          return void render('Endpoint profile deleted.');
        }
        const models = [
          ...new Set(
            value.models
              .split(/[\n,]/)
              .map((x) => x.trim())
              .filter(Boolean),
          ),
        ];
        const model = value.type === 'test' ? value.model : models[0];
        if (!model) return void render('Add at least one model.');
        try {
          const key =
            value.apiKey?.trim() ||
            (await context.secrets.get(profileSecretKey(active.id))) ||
            (await context.secrets.get('sqlOrganizer.openaiApiKey'));
          if (!key) return void render('Enter an API key to test this endpoint.');
          const provider = new OpenAiProvider({
            apiKey: key,
            model,
            baseUrl: value.baseUrl,
            protocol: value.protocol,
            timeoutMs: 15000,
          });
          if (value.type === 'test') {
            await provider.testConnection();
            return void render('Connection successful.');
          }
          const updated: LlmProfile = { ...active, baseUrl: value.baseUrl.trim(), apiProtocol: value.protocol, models };
          await store.save({
            ...settings,
            profiles: settings.profiles.map((profile) => (profile.id === active.id ? updated : profile)),
          });
          if (value.apiKey?.trim()) await context.secrets.store(profileSecretKey(active.id), value.apiKey.trim());
          await render('Saved globally. API keys are stored only in VS Code SecretStorage.');
        } catch (error) {
          await render(`Connection failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      undefined,
      context.subscriptions,
    );
    await render();
  }
}
function html(settings: LlmSettings, profile: LlmProfile, notice: string): string {
  const nonce = crypto.randomUUID();
  const esc = (x: string) =>
    x.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const profileOptions = settings.profiles
    .map(
      (item) =>
        `<option value="${esc(item.id)}" ${item.id === profile.id ? 'selected' : ''}>${esc(item.name)}${item.baseUrl ? ` — ${esc(item.baseUrl)}` : ''}</option>`,
    )
    .join('');
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><style nonce="${nonce}">body{font:14px var(--vscode-font-family);max-width:760px;margin:24px auto}label{display:block;margin:16px 0 6px}input,textarea,select{box-sizing:border-box;width:100%;padding:8px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border)}textarea{min-height:100px}button{margin:18px 8px 0 0;padding:8px 14px}.notice{min-height:20px;color:var(--vscode-editorInfo-foreground)}.endpoint-actions button{margin-top:8px}</style><body><h1>LLM Configuration</h1><p>Endpoint profiles are global to VS Code. Project-specific organization rules remain in <code>sql-organizer.config.yml</code>.</p><label>Endpoint profile</label><select id="profile">${profileOptions}</select><div class="endpoint-actions"><button id="add" type="button">Add endpoint</button><button id="delete" type="button" ${settings.profiles.length === 1 ? 'disabled' : ''}>Delete endpoint</button></div><label>Base URL</label><input id="url" value="${esc(profile.baseUrl)}" placeholder="https://api.openai.com/v1"><label>Protocol</label><select id="protocol"><option value="responses" ${profile.apiProtocol === 'responses' ? 'selected' : ''}>OpenAI Responses API</option><option value="chat-completions" ${profile.apiProtocol === 'chat-completions' ? 'selected' : ''}>Chat Completions compatible</option></select><label>Models</label><textarea id="models" placeholder="gpt-5\ngpt-4.1">${esc(profile.models.join('\n'))}</textarea><label>API Key</label><input id="key" type="password" autocomplete="off" placeholder="Stored securely after Save"><p class="notice">${esc(notice)}</p><button id="test">Test Connection</button><button id="save">Save</button><script nonce="${nonce}">const v=acquireVsCodeApi(),d=id=>document.getElementById(id),data=()=>({baseUrl:d('url').value,protocol:d('protocol').value,models:d('models').value,apiKey:d('key').value});d('profile').onchange=()=>v.postMessage({type:'selectProfile',id:d('profile').value});d('add').onclick=()=>{const name=prompt('Endpoint profile name');if(name&&name.trim())v.postMessage({type:'addProfile',name:name.trim()})};d('delete').onclick=()=>v.postMessage({type:'deleteProfile'});d('test').onclick=()=>{const x=data(),m=x.models.split(/[\\n,]/).map(s=>s.trim()).find(Boolean);v.postMessage({...x,type:'test',model:m||''})};d('save').onclick=()=>v.postMessage({...data(),type:'save'});</script></body>`;
}
