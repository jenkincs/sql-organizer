import * as vscode from 'vscode';
import { OrganizerConfig } from '../config/config';
import { ClassificationRecord, ModuleIndex, OrganizerPlan, SqlInventoryItem, TaxonomyState } from '../domain/models';
import { migrateClassifications, migrateInventory, migratePlan } from './stateMigration';
export class Repository {
  constructor(
    private readonly root: vscode.Uri,
    private readonly config: OrganizerConfig,
  ) {}
  private state(name: string): vscode.Uri {
    return vscode.Uri.joinPath(this.root, this.config.output.stateFolder, name);
  }
  async initialize(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.state(''));
    await vscode.workspace.fs.createDirectory(this.state(this.config.output.manifestFolder));
  }
  private async read<T>(name: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(this.state(name))).toString('utf8')) as T;
    } catch {
      return fallback;
    }
  }
  private async write(name: string, value: unknown): Promise<void> {
    await this.initialize();
    await vscode.workspace.fs.writeFile(this.state(name), Buffer.from(JSON.stringify(value, null, 2), 'utf8'));
  }
  inventory(): Promise<SqlInventoryItem[]> {
    return this.read<unknown>(this.config.output.inventoryFile, []).then(migrateInventory);
  }
  saveInventory(items: SqlInventoryItem[]): Promise<void> {
    return this.write(this.config.output.inventoryFile, items);
  }
  classifications(): Promise<ClassificationRecord[]> {
    return this.read<unknown>(this.config.output.classificationsFile, []).then(migrateClassifications);
  }
  saveClassifications(records: ClassificationRecord[]): Promise<void> {
    return this.write(this.config.output.classificationsFile, records);
  }
  plan(): Promise<OrganizerPlan | undefined> {
    return this.read<unknown>(this.config.output.planFile, undefined).then(migratePlan);
  }
  savePlan(plan: OrganizerPlan): Promise<void> {
    return this.write(this.config.output.planFile, plan);
  }
  taxonomy(): Promise<TaxonomyState | undefined> {
    return this.read<TaxonomyState | undefined>('taxonomy.json', undefined);
  }
  saveTaxonomy(state: TaxonomyState): Promise<void> {
    return this.write('taxonomy.json', state);
  }
  moduleIndex(): Promise<ModuleIndex> {
    return this.read<ModuleIndex>('module-index.json', {
      version: 1,
      entries: [],
      updatedAt: new Date().toISOString(),
    });
  }
  saveModuleIndex(index: ModuleIndex): Promise<void> {
    return this.write('module-index.json', index);
  }
  moduleDestination(category: string): string {
    return `${this.config.organization.moduleFolder.replace(/\/+$/, '')}/${category}.sql`;
  }
  async writeManifest(name: string, value: unknown): Promise<void> {
    return this.write(`${this.config.output.manifestFolder}/${name}`, value);
  }
  async lastManifest<T>(): Promise<T | undefined> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(this.state(this.config.output.manifestFolder));
      const name = entries
        .filter(([entry, type]) => type === vscode.FileType.File && entry.endsWith('.json'))
        .map(([entry]) => entry)
        .sort()
        .at(-1);
      return name ? this.read<T | undefined>(`${this.config.output.manifestFolder}/${name}`, undefined) : undefined;
    } catch {
      return undefined;
    }
  }
}
