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

  test('scans locally without an API key and preserves the dry-run inventory', async () => {
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

  test('creates a non-empty plan from classifications without mutating the fixture SQL', async () => {
    await vscode.commands.executeCommand('sqlOrganizer.initialize');
    await vscode.commands.executeCommand('sqlOrganizer.scan');
    const inventory = JSON.parse(await fs.readFile(path.join(statePath, 'inventory.json'), 'utf8'));
    inventory[0].classificationStatus = 'analyzed';
    await fs.writeFile(path.join(statePath, 'inventory.json'), JSON.stringify(inventory));
    await fs.writeFile(
      path.join(statePath, 'classifications.json'),
      JSON.stringify([
        {
          itemId: inventory[0].id,
          cacheKey: 'test',
          analyzedAt: new Date().toISOString(),
          classification: {
            category: 'customer',
            operation: 'SELECT',
            dialect: 'generic',
            purpose: 'Find a user',
            suggestedFilename: 'find-user.sql',
            tables: ['app_users'],
            parameters: [],
            risk: 'read-only',
            riskReasons: [],
            confidence: 0.9,
            reviewNotes: [],
          },
        },
      ]),
    );
    const before = await fs.readFile(path.join(fixture, 'query.sql'), 'utf8');
    await vscode.commands.executeCommand('sqlOrganizer.createPlan');
    const plan = JSON.parse(await fs.readFile(path.join(statePath, 'plan.json'), 'utf8'));
    assert.equal(
      await fs.stat(path.join(statePath, 'plan.json')).then(
        () => true,
        () => false,
      ),
      true,
    );
    assert.equal(plan.actions.length, 1);
    assert.equal(await fs.readFile(path.join(fixture, 'query.sql'), 'utf8'), before);
  });
});
