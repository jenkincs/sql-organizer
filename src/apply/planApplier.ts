import * as path from 'path';
import * as vscode from 'vscode';
import { OrganizerConfig } from '../config/config';
import { OrganizerPlan, PlanAction } from '../domain/models';
import { sha256 } from '../scanner/sqlAnalyzer';
import { Repository } from '../storage/repository';
import { checkGit, GitState } from './gitGuard';
import { assertNoSymlink, safeDestination } from './pathGuard';
export interface ApplyManifest {
  version: 1;
  planId: string;
  extensionVersion: string;
  appliedAt: string;
  gitState: GitState;
  result: 'success' | 'failed';
  moves: { source: string; destination: string; sourceHashBefore: string; destinationHashAfter: string }[];
  errors: string[];
}
export class PlanApplier {
  constructor(
    private readonly root: vscode.Uri,
    private readonly config: OrganizerConfig,
    private readonly repository: Repository,
  ) {}
  async apply(plan: OrganizerPlan): Promise<ApplyManifest> {
    if (plan.configHash !== sha256(JSON.stringify(this.config)))
      throw new Error('Plan is stale because configuration changed. Create a new plan.');
    const actions = plan.actions.filter((x) => x.status === 'approved');
    if (!actions.length) throw new Error('No approved plan actions to apply.');
    const destinations = new Set<string>();
    for (const action of actions) await this.preflight(action, destinations);
    const gitState = await checkGit(
      this.root,
      this.config.safety.requireGitRepository,
      this.config.safety.requireCleanGitForApply,
    );
    const moves: ApplyManifest['moves'] = [];
    const errors: string[] = [];
    try {
      for (const action of actions) {
        const source = vscode.Uri.parse(action.sourceUri);
        const destination = safeDestination(this.root, action.finalDestination);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.posix.dirname(destination.path)));
        await vscode.workspace.fs.rename(source, destination, { overwrite: false });
        const destinationHashAfter = sha256(
          Buffer.from(await vscode.workspace.fs.readFile(destination)).toString('utf8'),
        );
        moves.push({
          source: action.sourceRelativePath,
          destination: action.finalDestination,
          sourceHashBefore: action.sourceRawHash,
          destinationHashAfter,
        });
        action.status = 'applied';
      }
      plan.status = 'applied';
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      for (const move of [...moves].reverse())
        try {
          await vscode.workspace.fs.rename(
            safeDestination(this.root, move.destination),
            vscode.Uri.joinPath(this.root, ...move.source.split('/')),
            { overwrite: false },
          );
        } catch (rollbackError) {
          errors.push(
            `Automatic rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          );
        }
      plan.status = 'partially-applied';
    }
    const manifest: ApplyManifest = {
      version: 1,
      planId: plan.id,
      extensionVersion: '0.1.0',
      appliedAt: new Date().toISOString(),
      gitState,
      result: errors.length ? 'failed' : 'success',
      moves,
      errors,
    };
    await this.repository.writeManifest(`manifest-${Date.now()}.json`, manifest);
    await this.repository.savePlan(plan);
    if (errors.length) throw new Error(errors.join('; '));
    return manifest;
  }
  private async preflight(action: PlanAction, destinations: Set<string>): Promise<void> {
    if (action.validationErrors.length || action.status !== 'approved')
      throw new Error(`Action ${action.sourceRelativePath} is not valid for Apply.`);
    const source = vscode.Uri.parse(action.sourceUri);
    const raw = sha256(Buffer.from(await vscode.workspace.fs.readFile(source)).toString('utf8'));
    if (raw !== action.sourceRawHash) throw new Error(`Source changed: ${action.sourceRelativePath}`);
    const destination = safeDestination(this.root, action.finalDestination);
    await assertNoSymlink(this.root, destination);
    if (destinations.has(destination.toString())) throw new Error(`Duplicate destination: ${action.finalDestination}`);
    destinations.add(destination.toString());
    try {
      await vscode.workspace.fs.stat(destination);
      throw new Error(`Destination exists: ${action.finalDestination}`);
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return;
      throw error;
    }
  }
}
