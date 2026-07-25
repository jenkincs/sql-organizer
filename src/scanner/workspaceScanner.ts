import * as path from 'path';
import * as vscode from 'vscode';
import { OrganizerConfig } from '../config/config';
import { SqlInventoryItem } from '../domain/models';
import { assignExactDuplicateGroups } from '../duplicate/exactDuplicateDetector';
import {
  detectDialect,
  detectOperation,
  extractParameters,
  extractTables,
  normalizeSql,
  normalizedTokenSignature,
  sha256,
  splitSqlStatements,
} from './sqlAnalyzer';
export async function scanWorkspace(
  root: vscode.Uri,
  config: OrganizerConfig,
  token?: vscode.CancellationToken,
): Promise<SqlInventoryItem[]> {
  const include = new vscode.RelativePattern(root, `{${config.root.include.join(',')}}`);
  const exclude = `{${config.root.exclude.join(',')}}`;
  const uris = await vscode.workspace.findFiles(include, exclude);
  const items: SqlInventoryItem[] = [];
  for (const uri of uris) {
    if (token?.isCancellationRequested) break;
    const stat = await vscode.workspace.fs.stat(uri);
    const relativePath = path.posix.relative(root.path, uri.path);
    const warnings: string[] = [];
    if (stat.size > config.root.maxFileBytes) {
      warnings.push('file-too-large');
      items.push({
        id: sha256(uri.toString()),
        uri: uri.toString(),
        relativePath,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime,
        rawHash: '',
        normalizedHash: '',
        normalizedTokens: [],
        operation: 'UNKNOWN',
        dialectHint: 'unknown',
        tables: [],
        parameters: [],
        warnings,
        classificationStatus: 'not-analyzed',
      });
      continue;
    }
    const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    const sourceHash = sha256(text);
    const fragments = config.splitting.enabled ? splitSqlStatements(text, config.splitting.maxStatementsPerFile) : [];
    const units =
      fragments.length > 1
        ? fragments
        : [{ sql: text, index: 0, startLine: 1, endLine: text.split('\n').length, safety: 'keep-together' as const }];
    for (const unit of units) {
      const statement = unit.sql;
      const isStatement = units.length > 1;
      items.push({
        id: sha256(`${uri.toString()}#${unit.index}:${sha256(statement)}`),
        uri: uri.toString(),
        relativePath: isStatement ? `${relativePath}#L${unit.startLine}-L${unit.endLine}` : relativePath,
        sizeBytes: Buffer.byteLength(statement, 'utf8'),
        modifiedAt: stat.mtime,
        rawHash: sha256(statement),
        normalizedHash: sha256(normalizeSql(statement)),
        normalizedTokens: normalizedTokenSignature(statement),
        operation: detectOperation(statement),
        dialectHint: detectDialect(statement),
        tables: extractTables(statement),
        parameters: extractParameters(statement),
        warnings,
        classificationStatus: 'not-analyzed',
        unitKind: isStatement ? 'statement' : 'file',
        sourceFileUri: uri.toString(),
        sourceFileRelativePath: relativePath,
        sourceFileRawHash: sourceHash,
        statementIndex: unit.index,
        startLine: unit.startLine,
        endLine: unit.endLine,
        splitSafety: unit.safety,
      });
    }
  }
  assignExactDuplicateGroups(items);
  return items;
}
