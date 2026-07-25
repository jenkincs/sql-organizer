import * as vscode from 'vscode';
import { z } from 'zod';
import { ClassificationRecord, OrganizerPlan, SqlInventoryItem } from '../../domain/models';
import { Repository } from '../../storage/repository';
const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('approve'), id: z.string() }),
  z.object({ type: z.literal('reject'), id: z.string() }),
  z.object({
    type: z.literal('edit'),
    id: z.string(),
    category: z.string().optional(),
    filename: z.string().optional(),
    operationFolder: z.string().optional(),
    destination: z.string().optional(),
    note: z.string().max(1000).optional(),
  }),
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
    const plan = await repository.plan();
    if (!plan) return void vscode.window.showWarningMessage('Create a plan before opening Review.');
    if (this.current) {
      this.current.panel.reveal();
      await this.current.render();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'sqlOrganizer.review',
      'SQL Organizer Review',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    this.current = new ReviewPanel(context, panel, repository, apply);
    panel.onDidDispose(
      () => {
        this.current = undefined;
      },
      null,
      context.subscriptions,
    );
    await this.current.render();
  }
  private constructor(
    private readonly context: vscode.ExtensionContext,
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
    const action = plan.actions.find((item) => item.id === message.id);
    if (!action) return;
    if (message.type === 'approve') action.status = action.validationErrors.length ? 'conflict' : 'approved';
    if (message.type === 'reject') action.status = 'rejected';
    if (message.type === 'edit') {
      action.finalCategory = message.category ?? action.finalCategory;
      action.finalFilename = message.filename ?? action.finalFilename;
      action.finalOperationFolder = message.operationFolder ?? action.finalOperationFolder;
      action.finalDestination = message.destination ?? action.finalDestination;
      action.userNote = message.note ?? action.userNote;
      action.userModified = true;
      action.status = 'pending';
    }
    await this.repository.savePlan(plan);
    await this.render();
  }
  private async render(): Promise<void> {
    const plan = await this.repository.plan();
    if (!plan) return;
    this.panel.webview.html = html(
      this.panel.webview,
      plan,
      await this.repository.inventory(),
      await this.repository.classifications(),
    );
  }
}
function html(
  webview: vscode.Webview,
  plan: OrganizerPlan,
  inventory: SqlInventoryItem[],
  classifications: ClassificationRecord[],
): string {
  const nonce = crypto.randomUUID();
  const payload = JSON.stringify({ plan, inventory, classifications }).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><meta name="viewport" content="width=device-width,initial-scale=1"><style nonce="${nonce}">body{font:13px var(--vscode-font-family);padding:16px;color:var(--vscode-foreground)}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid var(--vscode-panel-border);padding:8px;text-align:left;vertical-align:top}button{margin:2px}.warning{color:var(--vscode-editorWarning-foreground)}.rejected{opacity:.55}.toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:12px 0}.detail{white-space:pre-wrap;border:1px solid var(--vscode-panel-border);padding:12px;min-height:48px;margin:12px 0}select{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);padding:4px}</style></head><body><h1>SQL Organizer Review</h1><p>Files scanned: ${plan.inventoryVersion} · Proposed moves: ${plan.actions.length} · Exact duplicates: ${plan.actions.filter((a) => a.exactDuplicateOf).length} · Similar candidates: ${plan.similarityCandidates.length} · Low confidence: ${plan.actions.filter((a) => a.confidence < 0.7).length} · Conflicts: ${plan.actions.filter((a) => a.status === 'conflict').length} · Estimated AI requests: ${plan.actions.length}</p><p><button id="apply">Apply approved plan</button> <span class="warning">No files will be deleted. Only approved, conflict-free moves can apply.</span></p><div class="toolbar"><label>Status <select id="status"><option value="all">All</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="pending">Needs review</option><option value="conflict">Conflict</option></select></label><label>Category <select id="category"><option value="all">All categories</option></select></label><label>Operation <select id="operation"><option value="all">All operations</option><option value="dml">DML</option><option value="DDL">DDL</option><option value="PLSQL">PL/SQL</option></select></label><label>Risk <select id="risk"><option value="all">All risks</option><option value="read-only">Read-only</option><option value="write">Write</option><option value="schema-change">Schema change</option><option value="dynamic">Dynamic</option><option value="unknown">Unknown</option></select></label><label><input id="low" type="checkbox"> Low confidence</label><label><input id="duplicates" type="checkbox"> Exact duplicates</label></div><section id="detail" class="detail" aria-live="polite">Select Details to inspect a proposed move.</section><table><thead><tr><th>Original path</th><th>Category</th><th>Operation</th><th>Filename</th><th>Destination</th><th>Confidence</th><th>Risk</th><th>Status</th><th>Actions</th></tr></thead><tbody id="rows"></tbody></table><script nonce="${nonce}">const vscode=acquireVsCodeApi(),data=${payload},plan=data.plan,rows=document.querySelector('#rows'),detail=document.querySelector('#detail'),status=document.querySelector('#status'),category=document.querySelector('#category'),operation=document.querySelector('#operation'),risk=document.querySelector('#risk'),low=document.querySelector('#low'),duplicates=document.querySelector('#duplicates'),byId=new Map(data.inventory.map(x=>[x.id,x])),classificationById=new Map(data.classifications.map(x=>[x.itemId,x.classification]));for(const value of [...new Set(plan.actions.map(a=>a.finalCategory))].sort()){const option=document.createElement('option');option.value=value;option.textContent=value;category.append(option);}const filters=a=>(status.value==='all'||a.status===status.value)&&(category.value==='all'||a.finalCategory===category.value)&&(operation.value==='all'||operation.value==='dml'&&['query','dml'].includes(a.finalOperationFolder)||operation.value==='DDL'&&a.finalOperationFolder==='ddl'||operation.value==='PLSQL'&&a.finalOperationFolder==='plsql')&&(risk.value==='all'||a.risk===risk.value)&&(!low.checked||a.confidence<.7)&&(!duplicates.checked||Boolean(a.exactDuplicateOf));const text=(cell,value)=>cell.textContent=value??'';function show(a){const item=byId.get(a.id),c=classificationById.get(a.id),similar=plan.similarityCandidates.filter(x=>x.leftId===a.id||x.rightId===a.id).map(x=>x.reason+' ('+x.score+')').join('; ')||'None';detail.textContent=['Purpose: '+(c?.purpose||a.reason),'Tables: '+(c?.tables||item?.tables||[]).join(', '),'Parameters: '+(c?.parameters||item?.parameters||[]).join(', '),'Dialect: '+(c?.dialect||item?.dialectHint||'unknown'),'Source: '+a.sourceRelativePath,'Proposed destination: '+a.finalDestination,'Risk: '+a.risk+' — '+(c?.riskReasons||[]).join('; '),'Similarity: '+similar,'Exact duplicate source: '+(a.exactDuplicateOf||'None'),'AI review notes: '+(c?.reviewNotes||[]).join('; '),'Hash: '+(item?.rawHash||'Unavailable'),'File size: '+(item?.sizeBytes??'Unavailable'),'Validation: '+(a.validationErrors.length?a.validationErrors.join('; '):'No validation errors'),'User note: '+(a.userNote||'None')].join('\\n');}function edit(a){const category=prompt('Category',a.finalCategory),operationFolder=prompt('Operation folder',a.finalOperationFolder),filename=prompt('Filename',a.finalFilename),destination=prompt('Destination folder',a.finalDestination),note=prompt('Review note',a.userNote||'');if([category,operationFolder,filename,destination,note].some(x=>x!==null))vscode.postMessage({type:'edit',id:a.id,...(category!==null?{category}:{}),...(operationFolder!==null?{operationFolder}:{}),...(filename!==null?{filename}:{}),...(destination!==null?{destination}:{}),...(note!==null?{note}:{})});}function draw(){const actions=plan.actions.filter(filters);rows.replaceChildren(...actions.map(a=>{const tr=document.createElement('tr');tr.className=a.status;for(let i=0;i<9;i++)tr.append(document.createElement('td'));const c=tr.children;text(c[0],a.sourceRelativePath);text(c[1],a.finalCategory);text(c[2],a.finalOperationFolder);text(c[3],a.finalFilename);text(c[4],a.finalDestination);text(c[5],String(a.confidence));text(c[6],a.risk);text(c[7],a.status);for(const [label,fn] of [['Approve',()=>vscode.postMessage({type:'approve',id:a.id})],['Reject',()=>vscode.postMessage({type:'reject',id:a.id})],['Edit',()=>edit(a)],['Details',()=>show(a)],['Open SQL',()=>vscode.postMessage({type:'openSql',uri:a.sourceUri})]]){const b=document.createElement('button');b.textContent=label;b.onclick=fn;c[8].append(b);}return tr;}));}for(const element of [status,category,operation,risk,low,duplicates])element.onchange=draw;document.querySelector('#apply').onclick=()=>vscode.postMessage({type:'apply'});draw();</script></body></html>`;
}
