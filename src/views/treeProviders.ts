import * as vscode from 'vscode';
import { Repository } from '../storage/repository';

export class OrganizerTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  constructor(
    private readonly kind: 'workflow' | 'overview' | 'library' | 'issues',
    private readonly repository: () => Promise<Repository | undefined>,
  ) {}
  refresh(): void {
    this.changed.fire(undefined);
  }
  async getChildren(): Promise<vscode.TreeItem[]> {
    const repo = await this.repository();
    const inventory = (await repo?.inventory()) ?? [];
    const classifications = (await repo?.classifications()) ?? [];
    const plan = await repo?.plan();
    const item = (label: string, count: number, command?: string): vscode.TreeItem => {
      const node = new vscode.TreeItem(`${label}  ${count}`, vscode.TreeItemCollapsibleState.None);
      node.command = command ? { command, title: label } : undefined;
      return node;
    };
    const action = (label: string, description: string, command: string, icon: string): vscode.TreeItem => {
      const node = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
      node.description = description;
      node.tooltip = `${label}\n${description}`;
      node.iconPath = new vscode.ThemeIcon(icon);
      node.command = { command, title: label };
      return node;
    };
    if (this.kind === 'workflow') {
      const approved =
        plan?.actions.filter((item) => item.status === 'approved' && !item.validationErrors.length).length ?? 0;
      const pending = plan?.actions.filter((item) => item.status === 'pending').length ?? 0;
      return [
        action('1  Configure LLM', 'Endpoint, model, and API key', 'sqlOrganizer.configure', 'gear'),
        action('2  Scan and Create Plan', 'Scan → classify → generate Review plan', 'sqlOrganizer.scan', 'search'),
        action(
          '3  Review and Apply',
          approved
            ? `${approved} approved action${approved === 1 ? '' : 's'} ready`
            : pending
              ? `${pending} action${pending === 1 ? '' : 's'} awaiting review`
              : 'Open the current plan',
          'sqlOrganizer.openReview',
          'checklist',
        ),
        action(
          'Open Project Rules',
          'Optional taxonomy and safety settings',
          'sqlOrganizer.openConfig',
          'settings-gear',
        ),
        action(
          'Roll Back Last Apply',
          'Restore the most recent safe Apply',
          'sqlOrganizer.rollbackLastApply',
          'history',
        ),
      ];
    }
    if (!repo) return [];
    if (this.kind === 'overview')
      return [
        item('Inbox', inventory.filter((x) => x.classificationStatus === 'not-analyzed').length, 'sqlOrganizer.scan'),
        item(
          'Pending Analysis',
          inventory.filter((x) => x.classificationStatus !== 'analyzed').length,
          'sqlOrganizer.scan',
        ),
        item('Classified', classifications.length, 'sqlOrganizer.openReview'),
        item(
          'Exact Duplicates',
          inventory.filter((x) => x.exactDuplicateGroupId).length,
          'sqlOrganizer.detectDuplicates',
        ),
        item(
          'Low Confidence',
          classifications.filter((x) => x.classification.confidence < 0.7).length,
          'sqlOrganizer.openReview',
        ),
        item(
          'Pending Plan',
          plan?.actions.filter((x) => x.status === 'pending').length ?? 0,
          'sqlOrganizer.openReview',
        ),
        new vscode.TreeItem(
          `Last Scan  ${inventory.length ? new Date(Math.max(...inventory.map((x) => x.modifiedAt))).toLocaleString() : 'never'}`,
        ),
      ];
    if (this.kind === 'library')
      return ['By Category', 'By Table', 'By Risk'].map(
        (label) => new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed),
      );
    return [
      item('Exact Duplicates', inventory.filter((x) => x.exactDuplicateGroupId).length, 'sqlOrganizer.openReview'),
      item('Similar SQL', plan?.similarityCandidates.length ?? 0, 'sqlOrganizer.openReview'),
      item(
        'Low Confidence',
        classifications.filter((x) => x.classification.confidence < 0.7).length,
        'sqlOrganizer.openReview',
      ),
      item(
        'Naming Conflicts',
        plan?.actions.filter((x) => x.status === 'conflict').length ?? 0,
        'sqlOrganizer.openReview',
      ),
      item(
        'Analysis Errors',
        inventory.filter((x) => x.classificationStatus === 'analysis-error').length,
        'sqlOrganizer.scan',
      ),
    ];
  }
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }
}
