import * as vscode from 'vscode';
import { OrganizerConfig } from '../config/config';
import { ClassificationRecord, OrganizerPlan, SqlInventoryItem } from '../domain/models';
export async function writeReports(
  root: vscode.Uri,
  config: OrganizerConfig,
  inventory: SqlInventoryItem[],
  classifications: ClassificationRecord[],
  plan?: OrganizerPlan,
): Promise<void> {
  const classified = new Map(classifications.map((x) => [x.itemId, x.classification]));
  const lines = [
    '# SQL Organizer Report',
    '',
    '## Scan Summary',
    '',
    `- Source files scanned: ${new Set(inventory.map((item) => item.sourceFileRelativePath ?? item.relativePath)).size}`,
    `- SQL units scanned: ${inventory.length}`,
    `- Classified: ${classifications.length}`,
    `- Exact duplicates: ${inventory.filter((x) => x.exactDuplicateGroupId).length}`,
    `- Similar candidates: ${plan?.similarityCandidates.length ?? 0}`,
    `- Proposed moves: ${plan?.actions.length ?? 0}`,
    '',
    '## Safety',
    '',
    '- No SQL was executed, deleted, overwritten, or modified.',
    '- API keys and unredacted SQL are not written to this report.',
  ];
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(root, config.output.reportFile),
    Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
  );
  const index = [
    '# SQL Index',
    '',
    ...inventory.map((item) => {
      const c = classified.get(item.id);
      return `- **${item.relativePath}** — ${c?.purpose ?? 'Not analyzed'}; ${item.operation}; ${item.dialectHint}; tables: ${item.tables.join(', ') || 'none'}; confidence: ${c?.confidence ?? 'n/a'}`;
    }),
  ];
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(root, config.output.indexFile),
    Buffer.from(`${index.join('\n')}\n`, 'utf8'),
  );
}
