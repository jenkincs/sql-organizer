const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const vscode = require('vscode');

suite('SQL Organizer Extension Host', () => {
  const fixture = path.resolve(__dirname, '../fixtures/sql-workspace');
  const configPath = path.join(fixture, 'sql-organizer.config.yml');
  const statePath = path.join(fixture, '.sql-organizer');

  setup(async () => {
    await fs.rm(configPath, { force: true });
    await fs.rm(statePath, { recursive: true, force: true });
    await vscode.extensions.getExtension('sql-organizer.sql-organizer')?.activate();
  });

  test('activates and registers the documented commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'sqlOrganizer.initialize',
      'sqlOrganizer.scan',
      'sqlOrganizer.analyze',
      'sqlOrganizer.createPlan',
      'sqlOrganizer.openReview',
      'sqlOrganizer.applyApprovedPlan',
      'sqlOrganizer.rollbackLastApply',
      'sqlOrganizer.setApiKey',
    ])
      assert(commands.includes(id), `missing command: ${id}`);
  });

  test('initializes, scans and produces a dry-run inventory without an API key', async () => {
    await vscode.commands.executeCommand('sqlOrganizer.initialize');
    assert.equal(
      await fs.stat(configPath).then(
        () => true,
        () => false,
      ),
      true,
    );
    await vscode.commands.executeCommand('sqlOrganizer.scan');
    const inventory = JSON.parse(await fs.readFile(path.join(statePath, 'inventory.json'), 'utf8'));
    assert.equal(inventory.length, 1);
    assert.equal(inventory[0].operation, 'SELECT');
    assert.equal(inventory[0].classificationStatus, 'not-analyzed');
  });

  test('creates a plan and opens Review without mutating the fixture SQL', async () => {
    await vscode.commands.executeCommand('sqlOrganizer.initialize');
    await vscode.commands.executeCommand('sqlOrganizer.scan');
    const before = await fs.readFile(path.join(fixture, 'query.sql'), 'utf8');
    await vscode.commands.executeCommand('sqlOrganizer.createPlan');
    assert.equal(
      await fs.stat(path.join(statePath, 'plan.json')).then(
        () => true,
        () => false,
      ),
      true,
    );
    assert.equal(await fs.readFile(path.join(fixture, 'query.sql'), 'utf8'), before);
  });
});
