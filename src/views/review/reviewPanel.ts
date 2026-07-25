import * as vscode from 'vscode';
import { z } from 'zod';
import { ClassificationRecord, OrganizerPlan, SqlInventoryItem } from '../../domain/models';
import { Repository } from '../../storage/repository';
import { categoryLabel, categorySlug } from '../../taxonomy/taxonomyService';

const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('approve'), id: z.string() }),
  z.object({ type: z.literal('approveAll') }),
  z.object({ type: z.literal('reject'), id: z.string() }),
  z.object({ type: z.literal('assignModule'), id: z.string(), category: z.string().min(1).max(64) }),
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
    } else if (message.type === 'assignModule') {
      const action = plan.actions.find((item) => item.id === message.id);
      if (!action) return;
      const category = categorySlug(message.category);
      action.finalCategory = category;
      action.finalFilename = `${category}.sql`;
      action.finalDestination = this.repository.moduleDestination(category);
      action.userModified = true;
      action.taxonomyProposal = {
        slug: category,
        label: categoryLabel(category),
        reason: 'Assigned by reviewer.',
        actionId: action.id,
      };
      if (!plan.taxonomyProposals?.some((proposal) => proposal.slug === category))
        plan.taxonomyProposals = [...(plan.taxonomyProposals ?? []), action.taxonomyProposal];
      action.status = action.validationErrors.length ? 'pending' : 'approved';
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
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><style nonce="${nonce}">body{font:13px var(--vscode-font-family);padding:16px;color:var(--vscode-foreground)}button,select{margin:2px}.summary,.module,.detail{padding:12px;border:1px solid var(--vscode-panel-border);margin-bottom:12px}.proposal{color:var(--vscode-editorInfo-foreground)}.module h2{margin:0 0 8px;font-size:15px}table{width:100%;border-collapse:collapse}td,th{padding:7px;border-bottom:1px solid var(--vscode-panel-border);text-align:left;vertical-align:top}.detail{white-space:pre-wrap}.muted{opacity:.75}</style></head><body><h1>SQL Organizer Review</h1><section class="summary"><strong>Scan time:</strong> ${scanTime}<br><strong>SQL units:</strong> ${inventory.length} · <strong>Planned units:</strong> ${plan.actions.length} · <strong>Already organized:</strong> ${plan.skippedAlreadyOrganized ?? 0} · <strong>Approved:</strong> ${approved}<br><span class="proposal"><strong>New categories:</strong> ${plan.taxonomyProposals?.map((p) => p.slug).join(', ') || 'None'}</span><br><button id="approve-all" ${reviewable ? '' : 'disabled'}>Approve all ${reviewable} valid actions</button><button id="apply" ${approved ? '' : 'disabled'}>Apply ${approved} approved additions</button> Sources are preserved unless you explicitly enable source archiving.</section><label>Filter module <select id="filter"><option value="">All modules</option></select></label><section id="detail" class="detail">Select Details to inspect an SQL unit and its classification.</section><main id="modules"></main><script nonce="${nonce}">const vscode=acquireVsCodeApi(),data=${payload},plan=data.plan,items=new Map(data.inventory.map(i=>[i.id,i])),records=new Map(data.classifications.map(r=>[r.itemId,r.classification])),host=document.querySelector('#modules'),detail=document.querySelector('#detail'),filter=document.querySelector('#filter');const cell=(row,value)=>{const td=document.createElement('td');td.textContent=value;row.append(td)};const groups=Object.groupBy(plan.actions,a=>a.finalDestination);Object.keys(groups).sort().forEach(destination=>{const option=document.createElement('option');option.value=destination;option.textContent=destination+' ('+groups[destination].length+')';filter.append(option)});function show(action){const item=items.get(action.sourceUnitId||action.id),classification=records.get(action.sourceUnitId||action.id);detail.textContent=['Action: append to module','Source: '+action.sourceRelativePath,'Source range: '+(action.sourceStartLine?'Lines '+action.sourceStartLine+'–'+action.sourceEndLine:'Whole file'),'Module: '+action.finalDestination,'Purpose: '+(classification?.purpose||action.reason),'Primary category: '+action.finalCategory,'Related categories: '+(classification?.relatedCategories||[]).join(', ')||'None','Taxonomy: '+(classification?.taxonomyDecision||'existing'),'Risk: '+action.risk,'Split safety: '+(item?.splitSafety||'not applicable'),'Validation: '+(action.validationErrors.join('; ')||'None')].join('\\n')}function actionButton(label,fn){const b=document.createElement('button');b.textContent=label;b.onclick=fn;return b}function rowFor(action){const row=document.createElement('tr'),item=items.get(action.sourceUnitId||action.id);cell(row,action.sourceRelativePath);cell(row,item?.unitKind==='statement'?'Statement '+((item.statementIndex??0)+1):'Whole file');cell(row,action.finalCategory);cell(row,action.risk);cell(row,action.status);const actions=document.createElement('td');actions.append(actionButton('Approve',()=>vscode.postMessage({type:'approve',id:action.id})),actionButton('Reject',()=>vscode.postMessage({type:'reject',id:action.id})),actionButton('Assign module',()=>{const value=prompt('Business module name',action.finalCategory);if(value?.trim())vscode.postMessage({type:'assignModule',id:action.id,category:value})}),actionButton('Details',()=>show(action)),actionButton('Open SQL',()=>vscode.postMessage({type:'openSql',uri:action.sourceUri})));row.append(actions);return row}function draw(){host.replaceChildren();for(const [destination,actions] of Object.entries(groups).sort(([a],[b])=>a.localeCompare(b))){if(filter.value&&filter.value!==destination)continue;const section=document.createElement('section');section.className='module';const heading=document.createElement('h2');heading.textContent=destination+' · '+actions.length+' SQL unit'+(actions.length===1?'':'s');section.append(heading);const table=document.createElement('table');table.innerHTML='<thead><tr><th>Source</th><th>Unit</th><th>Module</th><th>Risk</th><th>Status</th><th>Actions</th></tr></thead>';const body=document.createElement('tbody');body.replaceChildren(...actions.map(rowFor));table.append(body);section.append(table);host.append(section)}}filter.onchange=draw;document.querySelector('#approve-all').onclick=()=>vscode.postMessage({type:'approveAll'});document.querySelector('#apply').onclick=()=>vscode.postMessage({type:'apply'});draw();</script></body></html>`;
}
