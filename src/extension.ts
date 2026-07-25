import * as vscode from 'vscode';
import { configFileName, loadConfig, writeDefaultConfig } from './config/config';
import { Logger } from './logging/logger';
import { Repository } from './storage/repository';
import { scanWorkspace } from './scanner/workspaceScanner';
import { OrganizerTreeProvider } from './views/treeProviders';
import { ClassificationProgress, ClassificationService, ClassificationSummary } from './ai/classificationService';
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
import { buildTaxonomyState, taxonomyPromptContext } from './taxonomy/taxonomyService';

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
  const workflow = new OrganizerTreeProvider('workflow', repository);
  const overview = new OrganizerTreeProvider('overview', repository);
  const library = new OrganizerTreeProvider('library', repository);
  const issues = new OrganizerTreeProvider('issues', repository);
  const refresh = () => {
    workflow.refresh();
    overview.refresh();
    library.refresh();
    issues.refresh();
  };
  const reportOperationError = async (operation: string, error: unknown): Promise<void> => {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error(`${operation} failed: ${detail}`);
    status.text = '$(error) SQL Organizer: Action Failed';
    refresh();
    const choice = await vscode.window.showErrorMessage(`SQL Organizer ${operation} failed: ${detail}`, 'Open Output');
    if (choice === 'Open Output') logger.show();
  };
  const reportClassificationFailures = async (summary: ClassificationSummary, repo: Repository): Promise<void> => {
    if (!summary.failed) return;
    const failedItems = (await repo.inventory()).filter((item) => item.classificationStatus === 'analysis-error');
    const details = failedItems
      .map((item) => `${item.relativePath}: ${item.classificationError?.message ?? 'Unknown classification error'}`)
      .join('; ');
    logger.warn(`${summary.failed} SQL classification${summary.failed === 1 ? '' : 's'} failed. ${details}`);
    const choice = await vscode.window.showWarningMessage(
      `${summary.failed} SQL file${summary.failed === 1 ? '' : 's'} could not be classified. Review contains only successful classifications.`,
      'Open Output',
    );
    if (choice === 'Open Output') logger.show();
  };
  const analyzeInventory = async (
    folder: vscode.Uri,
    config: Awaited<ReturnType<typeof loadConfig>>,
    repo: Repository,
    token?: vscode.CancellationToken,
    onProgress?: (progress: ClassificationProgress) => void,
  ): Promise<ClassificationSummary | undefined> => {
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
    if (!profile) return undefined;
    const key =
      (await context.secrets.get(profileSecretKey(profile.id))) ??
      (await context.secrets.get('sqlOrganizer.openaiApiKey'));
    if (!key) {
      vscode.window.showErrorMessage(
        'No API key is configured. Run “SQL Organizer: Configure”, save an API key, then run Scan again.',
      );
      return undefined;
    }
    const model =
      profile.models.length > 1
        ? await vscode.window.showQuickPick(profile.models, {
            title: 'SQL Organizer: Select AI model',
            placeHolder: 'Select a model for this scan',
          })
        : profile.models[0];
    if (!model) {
      vscode.window.showErrorMessage(
        'No model is configured. Run “SQL Organizer: Configure”, add a model, then run Scan again.',
      );
      return undefined;
    }
    const provider = new OpenAiProvider({
      apiKey: key,
      model,
      baseUrl: profile.baseUrl,
      protocol: profile.apiProtocol,
      timeoutMs: config.ai.timeoutMs,
    });
    const taxonomy = buildTaxonomyState(
      config.taxonomy.categories,
      await repo.taxonomy(),
      await repo.inventory(),
      await repo.classifications(),
      await repo.plan(),
    );
    await repo.saveTaxonomy(taxonomy);
    return new ClassificationService(
      folder,
      config,
      repo,
      provider,
      `${profile.id}:${model}`,
      taxonomyPromptContext(taxonomy, config.taxonomy.maxContextExamples),
    ).analyze(await repo.inventory(), token, onProgress);
  };
  const createReviewPlan = async (
    folder: vscode.Uri,
    config: Awaited<ReturnType<typeof loadConfig>>,
    repo: Repository,
  ): Promise<boolean> => {
    const inventory = await repo.inventory();
    const classifications = await repo.classifications();
    const analyzedIds = new Set(
      inventory.filter((item) => item.classificationStatus === 'analyzed').map((item) => item.id),
    );
    const currentClassifications = classifications.filter((record) => analyzedIds.has(record.itemId));
    const plan = buildPlan(
      folder.toString(),
      sha256(JSON.stringify(config)),
      config,
      inventory,
      currentClassifications,
    );
    if (inventory.length && !plan.actions.length) {
      const failedItems = inventory.filter((item) => item.classificationStatus === 'analysis-error');
      const oversizedItems = inventory.filter((item) => item.warnings.includes('file-too-large'));
      if (!failedItems.length && oversizedItems.length === inventory.length) {
        const choice = await vscode.window.showErrorMessage(
          `No plan was created because all ${inventory.length} SQL file${inventory.length === 1 ? '' : 's'} exceed the configured maximum file size. Increase root.maxFileBytes in sql-organizer.config.yml, then scan again.`,
          'Open Configuration',
        );
        if (choice === 'Open Configuration') await vscode.commands.executeCommand('sqlOrganizer.openConfig');
        return false;
      }
      const firstError = failedItems[0]?.classificationError?.message ?? 'Unknown provider error.';
      logger.error(
        `No plan was created because every SQL classification failed. ${failedItems
          .map((item) => `${item.relativePath}: ${item.classificationError?.message ?? 'Unknown provider error.'}`)
          .join('; ')}`,
      );
      const choice = await vscode.window.showErrorMessage(
        `No plan was created because every SQL classification failed. First error: ${firstError}`,
        'Open Output',
        'Configure LLM',
      );
      if (choice === 'Open Output') logger.show();
      if (choice === 'Configure LLM') await vscode.commands.executeCommand('sqlOrganizer.configure');
      return false;
    }
    await repo.savePlan(plan);
    await writeReports(folder, config, inventory, currentClassifications, plan);
    status.text = '$(database) SQL Organizer: Plan Ready';
    refresh();
    await vscode.commands.executeCommand('sqlOrganizer.openReview');
    return true;
  };
  logger.setLevel(vscode.workspace.getConfiguration('sqlOrganizer').get('logLevel', 'info'));
  logger.info('SQL Organizer activated.');
  context.subscriptions.push(
    logger,
    status,
    vscode.window.registerTreeDataProvider('sqlOrganizer.workflow', workflow),
    vscode.window.registerTreeDataProvider('sqlOrganizer.overview', overview),
    vscode.window.registerTreeDataProvider('sqlOrganizer.library', library),
    vscode.window.registerTreeDataProvider('sqlOrganizer.issues', issues),
    vscode.commands.registerCommand('sqlOrganizer.openOutput', () => logger.show()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlOrganizer.openDocumentation', () =>
      vscode.env.openExternal(vscode.Uri.parse('https://github.com/jenkincs/sql-organizer#readme')),
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
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'SQL Organizer: Analyzing SQL files',
          cancellable: true,
        },
        async (_, token) => {
          const repo = new Repository(folder, config);
          const summary = await analyzeInventory(folder, config, repo, token);
          if (!summary || summary.cancelled) return;
          await reportClassificationFailures(summary, repo);
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
      await createReviewPlan(folder, config, repo);
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
      if (!approved.length)
        return void vscode.window.showWarningMessage(
          'No moves are approved yet. Open Review, approve individual rows or use "Approve all valid moves", then apply.',
        );
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
          title: 'SQL Organizer: Scan and create plan',
          cancellable: true,
        },
        async (progress, token) => {
          try {
            status.text = '$(sync~spin) SQL Organizer: Scanning';
            const config = await loadConfig(folder);
            progress.report({ message: 'Scanning SQL files…', increment: 20 });
            const items = await scanWorkspace(folder, config, token);
            const repo = new Repository(folder, config);
            await repo.saveInventory(items);
            logger.info(`Scanned ${items.length} SQL file(s).`);
            refresh();
            if (token.isCancellationRequested) {
              status.text = '$(database) SQL Organizer: Scan cancelled';
              return void vscode.window.showInformationMessage(
                'SQL Organizer scan cancelled. Completed work was saved.',
              );
            }
            if (!items.length) {
              status.text = '$(database) SQL Organizer: No SQL files found';
              return void vscode.window.showInformationMessage('SQL Organizer found no SQL files to organize.');
            }
            progress.report({ message: `Classifying ${items.length} SQL file(s)…` });
            const summary = await analyzeInventory(
              folder,
              config,
              repo,
              token,
              ({ completed, total, item, outcome }) => {
                progress.report({
                  message: `Classifying ${completed}/${total}: ${item.relativePath}${outcome === 'failed' ? ' (failed)' : ''}`,
                  increment: total ? 55 / total : 0,
                });
              },
            );
            if (!summary) {
              status.text = `$(database) SQL Organizer: ${items.length} scanned`;
              return;
            }
            if (summary.cancelled) {
              status.text = '$(database) SQL Organizer: Analysis cancelled';
              return void vscode.window.showInformationMessage(
                'SQL Organizer analysis cancelled. Completed classifications were saved.',
              );
            }
            await reportClassificationFailures(summary, repo);
            progress.report({ message: 'Creating review plan…', increment: 25 });
            if (await createReviewPlan(folder, config, repo)) {
              status.text = '$(database) SQL Organizer: Review Ready';
              vscode.window.showInformationMessage(
                `SQL Organizer created a plan from ${summary.analyzed + summary.cached} classification${summary.analyzed + summary.cached === 1 ? '' : 's'}.`,
              );
            }
          } catch (error) {
            await reportOperationError('Scan and Create Plan', error);
          }
        },
      );
    }),
  );
}

export function deactivate(): void {}
