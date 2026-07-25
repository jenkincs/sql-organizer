import * as path from 'path';
import * as vscode from 'vscode';
import { OrganizerConfig } from '../config/config';
import { OrganizerPlan, PlanAction, TaxonomyState } from '../domain/models';
import { sha256, splitSqlStatements } from '../scanner/sqlAnalyzer';
import { Repository } from '../storage/repository';
import { checkGit, GitState } from './gitGuard';
import { assertNoSymlink, safeDestination } from './pathGuard';

export interface ApplyManifest {
  version: 2;
  planId: string;
  extensionVersion: string;
  appliedAt: string;
  gitState: GitState;
  result: 'success' | 'failed';
  moves: { source: string; destination: string; sourceHashBefore: string; destinationHashAfter: string }[];
  writes: { destination: string; destinationHashAfter: string }[];
  taxonomyAdded: string[];
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
    const actions = plan.actions.filter((action) => action.status === 'approved');
    if (!actions.length) throw new Error('No approved plan actions to apply.');
    const destinations = new Set<string>();
    for (const action of actions) await this.preflight(action, destinations);
    const archives = this.archiveCandidates(plan, actions);
    for (const archive of archives) await this.preflightDestination(archive.destination, destinations);
    const gitState = await checkGit(
      this.root,
      this.config.safety.requireGitRepository,
      this.config.safety.requireCleanGitForApply,
      [`${this.config.output.stateFolder}/**`, this.config.output.reportFile, this.config.output.indexFile],
    );
    const moves: ApplyManifest['moves'] = [];
    const writes: ApplyManifest['writes'] = [];
    const errors: string[] = [];
    try {
      for (const action of actions) {
        const destination = safeDestination(this.root, action.finalDestination);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.posix.dirname(destination.path)));
        if (action.kind === 'extract') {
          const content = await this.extractContent(action);
          await vscode.workspace.fs.writeFile(destination, Buffer.from(content, 'utf8'));
          writes.push({ destination: action.finalDestination, destinationHashAfter: sha256(content) });
        } else {
          const source = vscode.Uri.parse(action.sourceUri);
          await vscode.workspace.fs.rename(source, destination, { overwrite: false });
          moves.push({
            source: action.sourceRelativePath,
            destination: action.finalDestination,
            sourceHashBefore: action.sourceRawHash,
            destinationHashAfter: sha256(Buffer.from(await vscode.workspace.fs.readFile(destination)).toString('utf8')),
          });
        }
        action.status = 'applied';
      }
      for (const archive of archives) {
        const destination = safeDestination(this.root, archive.destination);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.posix.dirname(destination.path)));
        await vscode.workspace.fs.rename(archive.source, destination, { overwrite: false });
        moves.push({
          source: archive.relativePath,
          destination: archive.destination,
          sourceHashBefore: archive.rawHash,
          destinationHashAfter: sha256(Buffer.from(await vscode.workspace.fs.readFile(destination)).toString('utf8')),
        });
      }
      await this.persistApprovedTaxonomy(plan);
      plan.status = 'applied';
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      await this.rollbackPartial(moves, writes, errors);
      plan.status = 'partially-applied';
    }
    const manifest: ApplyManifest = {
      version: 2,
      planId: plan.id,
      extensionVersion: '0.2.0',
      appliedAt: new Date().toISOString(),
      gitState,
      result: errors.length ? 'failed' : 'success',
      moves,
      writes,
      taxonomyAdded: plan.taxonomyProposals?.map((proposal) => proposal.slug) ?? [],
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
    if (action.kind === 'extract') await this.extractContent(action);
    await this.preflightDestination(action.finalDestination, destinations);
  }

  private async preflightDestination(destination: string, destinations: Set<string>): Promise<void> {
    const uri = safeDestination(this.root, destination);
    await assertNoSymlink(this.root, uri);
    if (destinations.has(uri.toString())) throw new Error(`Duplicate destination: ${destination}`);
    destinations.add(uri.toString());
    try {
      await vscode.workspace.fs.stat(uri);
      throw new Error(`Destination exists: ${destination}`);
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return;
      throw error;
    }
  }

  private async extractContent(action: PlanAction): Promise<string> {
    const source = vscode.Uri.parse(action.sourceUri);
    const text = Buffer.from(await vscode.workspace.fs.readFile(source)).toString('utf8');
    const index = action.sourceStatementIndex;
    if (index === undefined) throw new Error(`Missing statement provenance: ${action.sourceRelativePath}`);
    const fragment = splitSqlStatements(text, this.config.splitting.maxStatementsPerFile)[index];
    if (!fragment || fragment.safety !== 'safe')
      throw new Error(`Statement boundary changed: ${action.sourceRelativePath}`);
    return fragment.sql;
  }

  private archiveCandidates(
    plan: OrganizerPlan,
    actions: PlanAction[],
  ): { source: vscode.Uri; relativePath: string; rawHash: string; destination: string }[] {
    const approvedSources = new Set(
      actions.filter((action) => action.kind === 'extract' && action.archiveSource).map((action) => action.sourceUri),
    );
    return [...approvedSources].flatMap((sourceUri) => {
      const sourceActions = plan.actions.filter((action) => action.sourceUri === sourceUri);
      if (
        !sourceActions.length ||
        !sourceActions.every((action) => action.kind === 'extract' && action.status === 'approved')
      )
        return [];
      const action = sourceActions[0];
      const filename = path.posix.basename(action.sourceRelativePath);
      return [
        {
          source: vscode.Uri.parse(sourceUri),
          relativePath: action.sourceRelativePath,
          rawHash: action.sourceRawHash,
          destination: `archive/mixed/${sha256(sourceUri).slice(0, 12)}-${filename}`,
        },
      ];
    });
  }

  private async persistApprovedTaxonomy(plan: OrganizerPlan): Promise<void> {
    const approved = new Set(
      plan.actions
        .filter((action) => action.status === 'applied')
        .flatMap((action) => (action.taxonomyProposal ? [action.taxonomyProposal.slug] : [])),
    );
    if (!approved.size) return;
    const current = await this.repository.taxonomy();
    const state: TaxonomyState = current ?? { version: 1, entries: [], updatedAt: new Date().toISOString() };
    for (const proposal of plan.taxonomyProposals ?? [])
      if (approved.has(proposal.slug) && !state.entries.some((entry) => entry.slug === proposal.slug))
        state.entries.push({
          slug: proposal.slug,
          label: proposal.label,
          source: 'approved',
          examples: [],
          createdAt: new Date().toISOString(),
        });
    state.updatedAt = new Date().toISOString();
    await this.repository.saveTaxonomy(state);
  }

  private async rollbackPartial(
    moves: ApplyManifest['moves'],
    writes: ApplyManifest['writes'],
    errors: string[],
  ): Promise<void> {
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
    for (const write of [...writes].reverse())
      try {
        const destination = safeDestination(this.root, write.destination);
        const content = Buffer.from(await vscode.workspace.fs.readFile(destination)).toString('utf8');
        if (sha256(content) === write.destinationHashAfter) await vscode.workspace.fs.delete(destination);
      } catch (rollbackError) {
        errors.push(
          `Automatic rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        );
      }
  }
}
