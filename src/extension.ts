import * as vscode from 'vscode';
import { configFileName, loadConfig, writeDefaultConfig } from './config/config';
import { Logger } from './logging/logger';
import { Repository } from './storage/repository';
import { scanWorkspace } from './scanner/workspaceScanner';
import { OrganizerTreeProvider } from './views/treeProviders';
import { ClassificationService } from './ai/classificationService';
import { OpenAiProvider } from './ai/openAiProvider';
import { buildPlan } from './planning/planBuilder';
import { writeReports } from './reports/reportWriter';
import { sha256 } from './scanner/sqlAnalyzer';
import { ReviewPanel } from './views/review/reviewPanel';
import { PlanApplier } from './apply/planApplier';
import { rollbackLast } from './apply/rollbackService';
import { ApplyManifest } from './apply/planApplier';
import { LlmConfigPanel } from './views/llmConfigPanel';
import { LlmSettingsStore, profileSecretKey } from './ai/llmSettingsStore';

export function activate(context: vscode.ExtensionContext): void {
  const logger = new Logger();
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = '$(database) SQL Organizer: Idle';
  status.show();
  let activeRoot = context.workspaceState.get<string>('sqlOrganizer.activeWorkspaceFolder');
  const root = (): vscode.Uri | undefined => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const selected = activeRoot ? folders.find((folder) => folder.uri.toString() === activeRoot)?.uri : undefined;
    return selected ?? folders[0]?.uri;
  };
  const selectWorkspaceFolder = async (): Promise<void> => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length)
      return void vscode.window.showErrorMessage('Open a workspace folder before selecting a SQL Organizer workspace.');
    const selected =
      folders.length === 1
        ? folders[0]
        : (
            await vscode.window.showQuickPick(
              folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
              {
                title: 'SQL Organizer: Select workspace folder',
                placeHolder: 'Choose the workspace containing this SQL library',
              },
            )
          )?.folder;
    if (!selected) return;
    activeRoot = selected.uri.toString();
    await context.workspaceState.update('sqlOrganizer.activeWorkspaceFolder', activeRoot);
    refresh();
    vscode.window.showInformationMessage(`SQL Organizer workspace: ${selected.name}`);
  };
  const repository = async () => {
    const folder = root();
    return folder ? new Repository(folder, await loadConfig(folder)) : undefined;
  };
  const overview = new OrganizerTreeProvider('overview', repository);
  const library = new OrganizerTreeProvider('library', repository);
  const issues = new OrganizerTreeProvider('issues', repository);
  const refresh = () => {
    overview.refresh();
    library.refresh();
    issues.refresh();
  };
  logger.setLevel(vscode.workspace.getConfiguration('sqlOrganizer').get('logLevel', 'info'));
  logger.info('SQL Organizer activated.');
  context.subscriptions.push(
    logger,
    status,
    vscode.window.registerTreeDataProvider('sqlOrganizer.overview', overview),
    vscode.window.registerTreeDataProvider('sqlOrganizer.library', library),
    vscode.window.registerTreeDataProvider('sqlOrganizer.issues', issues),
    vscode.commands.registerCommand('sqlOrganizer.openOutput', () => logger.show()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.openDocumentation', () =>
      vscode.env.openExternal(vscode.Uri.parse('https://github.com/sql-organizer/sql-organizer#readme')),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.selectWorkspaceFolder', selectWorkspaceFolder),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.initialize', async () => {
      const folder = root();
      if (!folder)
        return void vscode.window.showErrorMessage('Open a workspace folder before initializing SQL Organizer.');
      const uri = vscode.Uri.joinPath(folder, configFileName);
      try {
        await vscode.workspace.fs.stat(uri);
      } catch (error) {
        if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) throw error;
        await writeDefaultConfig(folder);
        logger.info(`Created ${configFileName}.`);
      }
      await new Repository(folder, await loadConfig(folder)).initialize();
      await vscode.window.showTextDocument(uri);
      refresh();
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.selectRoot', async () => {
      const folder = root();
      if (!folder) return void vscode.window.showErrorMessage('Open a workspace folder before selecting a SQL root.');
      const selected = await vscode.window.showInputBox({
        prompt: 'Workspace-relative SQL root',
        value: vscode.workspace.getConfiguration('sqlOrganizer').get('sqlRoot', ''),
      });
      if (selected !== undefined)
        await vscode.workspace
          .getConfiguration('sqlOrganizer')
          .update('sqlRoot', selected, vscode.ConfigurationTarget.Workspace);
    }),
  );
  context.subscriptions.push(vscode.commands.registerCommand('sqlOrganizer.refreshViews', refresh));
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.setApiKey', async () => {
      const key = await vscode.window.showInputBox({ prompt: 'OpenAI API key', password: true, ignoreFocusOut: true });
      if (key) {
        await context.secrets.store('sqlOrganizer.openaiApiKey', key);
        vscode.window.showInformationMessage('OpenAI API key saved in VS Code SecretStorage.');
      }
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.clearApiKey', async () => {
      await context.secrets.delete('sqlOrganizer.openaiApiKey');
      vscode.window.showInformationMessage('OpenAI API key cleared.');
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.analyze', async () => {
      const folder = root();
      if (!folder) return void vscode.window.showErrorMessage('Open a workspace folder before analyzing SQL files.');
      const config = await loadConfig(folder);
      const store = new LlmSettingsStore(context.globalStorageUri);
      const settings = await store.get(config);
      const profile =
        settings.profiles.length > 1
          ? (
              await vscode.window.showQuickPick(
                settings.profiles.map((item) => ({ label: item.name, description: item.baseUrl, item })),
                {
                  title: 'SQL Organizer: Select AI endpoint',
                  placeHolder: 'Select an endpoint profile',
                  matchOnDescription: true,
                },
              )
            )?.item
          : store.active(settings);
      if (!profile) return;
      const key =
        (await context.secrets.get(profileSecretKey(profile.id))) ??
        (await context.secrets.get('sqlOrganizer.openaiApiKey'));
      if (!key)
        return void vscode.window.showErrorMessage(
          'No API key is configured for this endpoint. Run “SQL Organizer: Configure” and save one.',
        );
      const model =
        profile.models.length > 1
          ? await vscode.window.showQuickPick(profile.models, {
              title: 'SQL Organizer: Select AI model',
              placeHolder: 'Select a model for this analysis run',
            })
          : profile.models[0];
      if (!model)
        return void vscode.window.showErrorMessage(
          'No model is configured for this endpoint. Run “SQL Organizer: Configure” and add one.',
        );
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `SQL Organizer: Analyzing SQL files with ${model}`,
          cancellable: true,
        },
        async (_, token) => {
          const repo = new Repository(folder, config);
          const provider = new OpenAiProvider({
            apiKey: key,
            model,
            baseUrl: profile.baseUrl,
            protocol: profile.apiProtocol,
            timeoutMs: config.ai.timeoutMs,
          });
          await new ClassificationService(folder, config, repo, provider, `${profile.id}:${model}`).analyze(
            await repo.inventory(),
            token,
          );
          status.text = '$(database) SQL Organizer: Analysis complete';
          refresh();
        },
      );
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.createPlan', async () => {
      const folder = root();
      if (!folder) return void vscode.window.showErrorMessage('Open a workspace folder before creating a plan.');
      const config = await loadConfig(folder);
      const repo = new Repository(folder, config);
      const inventory = await repo.inventory();
      const plan = buildPlan(
        folder.toString(),
        sha256(JSON.stringify(config)),
        config,
        inventory,
        await repo.classifications(),
      );
      await repo.savePlan(plan);
      await writeReports(folder, config, inventory, await repo.classifications(), plan);
      status.text = '$(database) SQL Organizer: Plan Ready';
      refresh();
      await vscode.commands.executeCommand('sqlOrganizer.openReview');
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.openReview', async () => {
      const repo = await repository();
      if (!repo) return void vscode.window.showErrorMessage('Open a workspace folder first.');
      await ReviewPanel.open(context, repo, async () =>
        vscode.commands.executeCommand('sqlOrganizer.applyApprovedPlan'),
      );
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.applyApprovedPlan', async () => {
      const folder = root();
      if (!folder) return;
      const config = await loadConfig(folder);
      const repo = new Repository(folder, config);
      const plan = await repo.plan();
      if (!plan) return void vscode.window.showWarningMessage('Create a plan before applying it.');
      const approved = plan.actions.filter((x) => x.status === 'approved' && !x.validationErrors.length);
      const confirmation = await vscode.window.showWarningMessage(
        `Apply ${approved.length} file moves? No files will be deleted. A manifest will be generated.`,
        { modal: true },
        'Apply',
      );
      if (confirmation !== 'Apply') return;
      try {
        await new PlanApplier(folder, config, repo).apply(plan);
        await writeReports(folder, config, await repo.inventory(), await repo.classifications(), plan);
        status.text = '$(database) SQL Organizer: Apply complete';
        refresh();
        vscode.window.showInformationMessage(`Applied ${approved.length} SQL Organizer move(s).`);
      } catch (error) {
        status.text = '$(error) SQL Organizer: Apply Failed';
        vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.rollbackLastApply', async () => {
      const folder = root();
      const repo = await repository();
      const manifest = await repo?.lastManifest<ApplyManifest>();
      if (!folder || !manifest)
        return void vscode.window.showWarningMessage('No apply manifest is available to roll back.');
      try {
        await rollbackLast(folder, manifest);
        vscode.window.showInformationMessage('Last SQL Organizer Apply was rolled back.');
        refresh();
      } catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.detectDuplicates', () =>
      vscode.commands.executeCommand('sqlOrganizer.scan'),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.openConfig', async () => {
      const folder = root();
      if (!folder) return void vscode.window.showErrorMessage('Open a workspace folder before opening configuration.');
      const uri = vscode.Uri.joinPath(folder, configFileName);
      try {
        await vscode.workspace.fs.stat(uri);
      } catch (error) {
        if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) throw error;
        await writeDefaultConfig(folder);
      }
      await vscode.window.showTextDocument(uri);
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.openReport', async () => {
      const folder = root();
      if (folder)
        await vscode.window.showTextDocument(vscode.Uri.joinPath(folder, (await loadConfig(folder)).output.reportFile));
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.regenerateIndex', async () => {
      const folder = root();
      const repo = await repository();
      if (folder && repo)
        await writeReports(
          folder,
          await loadConfig(folder),
          await repo.inventory(),
          await repo.classifications(),
          await repo.plan(),
        );
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.openFile', async (uri: string) =>
      vscode.window.showTextDocument(vscode.Uri.parse(uri)),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.configure', async () => {
      const folder = root();
      if (!folder) return void vscode.window.showErrorMessage('Open a workspace folder before configuring LLM access.');
      await LlmConfigPanel.open(context, folder);
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.approveItem', async (id: string) => {
      const repo = await repository();
      const plan = await repo?.plan();
      const action = plan?.actions.find((x) => x.id === id);
      if (repo && plan && action && !action.validationErrors.length) {
        action.status = 'approved';
        await repo.savePlan(plan);
        refresh();
      }
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.rejectItem', async (id: string) => {
      const repo = await repository();
      const plan = await repo?.plan();
      const action = plan?.actions.find((x) => x.id === id);
      if (repo && plan && action) {
        action.status = 'rejected';
        await repo.savePlan(plan);
        refresh();
      }
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.approveAllSafe', async () => {
      const repo = await repository();
      const plan = await repo?.plan();
      if (repo && plan) {
        plan.actions
          .filter((x) => !x.validationErrors.length && x.confidence >= 0.95 && x.risk === 'read-only')
          .forEach((x) => {
            x.status = 'approved';
          });
        await repo.savePlan(plan);
        refresh();
      }
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.scan', async () => {
      const folder = root();
      if (!folder) return void vscode.window.showErrorMessage('Open a workspace folder before scanning SQL files.');
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'SQL Organizer: Scanning SQL files',
          cancellable: true,
        },
        async (_, token) => {
          status.text = '$(sync~spin) SQL Organizer: Scanning';
          const config = await loadConfig(folder);
          const items = await scanWorkspace(folder, config, token);
          await new Repository(folder, config).saveInventory(items);
          logger.info(`Scanned ${items.length} SQL file(s).`);
          status.text = `$(database) SQL Organizer: ${items.filter((x) => x.classificationStatus !== 'analyzed').length} pending`;
          refresh();
          vscode.window.showInformationMessage(`SQL Organizer scanned ${items.length} SQL file(s).`);
        },
      );
    }),
  );
}

export function deactivate(): void {}
