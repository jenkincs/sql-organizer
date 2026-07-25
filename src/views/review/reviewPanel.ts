import * as vscode from 'vscode';
import { z } from 'zod';
import { ClassificationRecord, OrganizerPlan, SqlInventoryItem } from '../../domain/models';
import { Repository } from '../../storage/repository';

const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('approve'), id: z.string() }),
  z.object({ type: z.literal('approveAll') }),
  z.object({ type: z.literal('reject'), id: z.string() }),
  z.object({ type: z.literal('openSql'), uri: z.string().url() }),
  z.object({ type: z.literal('apply') }),
]);

export class ReviewPanel {
  private static current: ReviewPanel | undefined;
  static async open(
    context: vscode.ExtensionContext,
    repository: Repository,
    apply: () => Promise<void>,
  ): Promise<void> {
    if (!(await repository.plan()))
      return void vscode.window.showWarningMessage('Create a plan before opening Review.');
    if (this.current) {
      this.current.panel.reveal();
      return void (await this.current.render());
    }
    const panel = vscode.window.createWebviewPanel(
      'sqlOrganizer.review',
      'SQL Organizer Review',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );
    this.current = new ReviewPanel(context, panel, repository, apply);
    panel.onDidDispose(() => (ReviewPanel.current = undefined), undefined, context.subscriptions);
    await this.current.render();
  }
  private constructor(
    context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel,
    private readonly repository: Repository,
    private readonly apply: () => Promise<void>,
  ) {
    panel.webview.onDidReceiveMessage((raw: unknown) => this.onMessage(raw), undefined, context.subscriptions);
  }
  private async onMessage(raw: unknown): Promise<void> {
    const parsed = messageSchema.safeParse(raw);
    if (!parsed.success)
      return void vscode.window.showErrorMessage('Rejected an invalid SQL Organizer Review message.');
    const message = parsed.data;
    const plan = await this.repository.plan();
    if (!plan) return;
    if (message.type === 'openSql') return void vscode.window.showTextDocument(vscode.Uri.parse(message.uri));
    if (message.type === 'apply') return void this.apply();
    if (message.type === 'approveAll') {
      plan.actions
        .filter(
          (action) => !action.validationErrors.length && action.status !== 'conflict' && action.status !== 'rejected',
        )
        .forEach((action) => (action.status = 'approved'));
    } else {
      const action = plan.actions.find((item) => item.id === message.id);
      if (!action) return;
      action.status = message.type === 'approve' && !action.validationErrors.length ? 'approved' : 'rejected';
    }
    await this.repository.savePlan(plan);
    await this.render();
  }
  private async render(): Promise<void> {
    const plan = await this.repository.plan();
    if (!plan) return;
    this.panel.webview.html = html(plan, await this.repository.inventory(), await this.repository.classifications());
  }
}

function html(plan: OrganizerPlan, inventory: SqlInventoryItem[], classifications: ClassificationRecord[]): string {
  const nonce = crypto.randomUUID();
  const payload = JSON.stringify({ plan, inventory, classifications }).replace(/</g, '\\u003c');
  const approved = plan.actions.filter((action) => action.status === 'approved').length;
  const reviewable = plan.actions.filter(
    (action) => !action.validationErrors.length && !['conflict', 'rejected'].includes(action.status),
  ).length;
  const scanTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(plan.createdAt),
  );
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><style nonce="${nonce}">body{font:13px var(--vscode-font-family);padding:16px;color:var(--vscode-foreground)}button{margin:2px}.summary{padding:12px;border:1px solid var(--vscode-panel-border);margin-bottom:12px}.proposal{color:var(--vscode-editorInfo-foreground)}table{width:100%;border-collapse:collapse}td,th{padding:7px;border-bottom:1px solid var(--vscode-panel-border);text-align:left;vertical-align:top}.detail{white-space:pre-wrap;border:1px solid var(--vscode-panel-border);padding:10px;margin:12px 0}</style></head><body><h1>SQL Organizer Review</h1><section class="summary"><strong>Scan time:</strong> ${scanTime}<br><strong>SQL units:</strong> ${inventory.length} · <strong>Proposed actions:</strong> ${plan.actions.length} · <strong>Statement extractions:</strong> ${plan.actions.filter((a) => a.kind === 'extract').length} · <strong>Approved:</strong> ${approved}<br><span class="proposal"><strong>New categories:</strong> ${plan.taxonomyProposals?.map((p) => p.slug).join(', ') || 'None'}</span><br><button id="approve-all" ${reviewable ? '' : 'disabled'}>Approve all ${reviewable} valid actions</button><button id="apply" ${approved ? '' : 'disabled'}>Apply ${approved} approved actions</button> No files are deleted; extracted statements preserve their original source by default.</section><section id="detail" class="detail">Select Details to inspect a statement's source range and classification.</section><table><thead><tr><th>Source</th><th>Unit</th><th>Category</th><th>Destination</th><th>Risk</th><th>Status</th><th>Actions</th></tr></thead><tbody id="rows"></tbody></table><script nonce="${nonce}">const vscode=acquireVsCodeApi(),data=${payload},plan=data.plan,items=new Map(data.inventory.map(i=>[i.id,i])),records=new Map(data.classifications.map(r=>[r.itemId,r.classification])),rows=document.querySelector('#rows'),detail=document.querySelector('#detail');const cell=(row,value)=>{const td=document.createElement('td');td.textContent=value;row.append(td)};function show(action){const item=items.get(action.sourceUnitId||action.id),classification=records.get(action.sourceUnitId||action.id);detail.textContent=['Action: '+(action.kind||'move'),'Source: '+action.sourceRelativePath,'Source range: '+(action.sourceStartLine?'Lines '+action.sourceStartLine+'–'+action.sourceEndLine:'Whole file'),'Destination: '+action.finalDestination,'Purpose: '+(classification?.purpose||action.reason),'Primary category: '+action.finalCategory,'Related categories: '+(classification?.relatedCategories||[]).join(', '),'Taxonomy: '+(classification?.taxonomyDecision||'existing'),'Risk: '+action.risk,'Split safety: '+(item?.splitSafety||'not applicable'),'Validation: '+(action.validationErrors.join('; ')||'None')].join('\\n')}function draw(){rows.replaceChildren(...plan.actions.map(action=>{const row=document.createElement('tr');cell(row,action.sourceRelativePath);cell(row,action.kind==='extract'?'Statement '+((items.get(action.sourceUnitId||action.id)?.statementIndex??0)+1):'Whole file');cell(row,action.finalCategory);cell(row,action.finalDestination);cell(row,action.risk);cell(row,action.status);const actions=document.createElement('td');for(const [label,run] of [['Approve',()=>vscode.postMessage({type:'approve',id:action.id})],['Reject',()=>vscode.postMessage({type:'reject',id:action.id})],['Details',()=>show(action)],['Open SQL',()=>vscode.postMessage({type:'openSql',uri:action.sourceUri})]]){const button=document.createElement('button');button.textContent=label;button.onclick=run;actions.append(button)}row.append(actions);return row}))}document.querySelector('#approve-all').onclick=()=>vscode.postMessage({type:'approveAll'});document.querySelector('#apply').onclick=()=>vscode.postMessage({type:'apply'});draw();</script></body></html>`;
}
