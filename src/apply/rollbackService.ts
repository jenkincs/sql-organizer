import * as vscode from 'vscode';
import { ApplyManifest } from './planApplier';
import { sha256 } from '../scanner/sqlAnalyzer';
import { safeDestination } from './pathGuard';
export async function rollbackLast(root: vscode.Uri, manifest: ApplyManifest): Promise<void> {
  if (manifest.result !== 'success') throw new Error('Only a successful last Apply may be rolled back.');
  for (const move of manifest.moves) {
    const destination = safeDestination(root, move.destination);
    const source = vscode.Uri.joinPath(root, ...move.source.split('/'));
    try {
      await vscode.workspace.fs.stat(source);
      throw new Error(`Rollback conflict: source exists: ${move.source}`);
    } catch (error) {
      if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) throw error;
    }
    if (
      sha256(Buffer.from(await vscode.workspace.fs.readFile(destination)).toString('utf8')) !==
      move.destinationHashAfter
    )
      throw new Error(`Rollback conflict: destination changed: ${move.destination}`);
  }
  for (const write of manifest.writes) {
    const destination = safeDestination(root, write.destination);
    if (
      sha256(Buffer.from(await vscode.workspace.fs.readFile(destination)).toString('utf8')) !==
      write.destinationHashAfter
    )
      throw new Error(`Rollback conflict: generated file changed: ${write.destination}`);
  }
  for (const move of [...manifest.moves].reverse())
    await vscode.workspace.fs.rename(
      safeDestination(root, move.destination),
      vscode.Uri.joinPath(root, ...move.source.split('/')),
      { overwrite: false },
    );
  for (const write of [...manifest.writes].reverse()) {
    const destination = safeDestination(root, write.destination);
    if (write.existedBefore)
      await vscode.workspace.fs.writeFile(destination, Buffer.from(write.previousContent ?? '', 'utf8'));
    else await vscode.workspace.fs.delete(destination);
  }
}
