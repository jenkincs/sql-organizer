const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const vscode = require('vscode');
const { defaultConfig, Repository, PlanApplier, rollbackLast, sha256 } = require('../../dist/testing.js');
const exec = promisify(execFile);

suite('SQL Organizer Apply integration', () => {
  const folder = path.resolve(__dirname, '../fixtures/apply-workspace');
  const root = vscode.Uri.file(folder);
  const config = JSON.parse(JSON.stringify(defaultConfig));
  config.safety.requireCleanGitForApply = false;
  const makePlan = (source, text, destination = 'customer/query/find-user.sql') => ({
    version: 1,
    id: 'test-plan',
    rootUri: root.toString(),
    createdAt: new Date().toISOString(),
    inventoryVersion: '1',
    configHash: sha256(JSON.stringify(config)),
    similarityCandidates: [],
    warnings: [],
    status: 'ready',
    actions: [
      {
        id: 'action',
        sourceUri: source.toString(),
        sourceRelativePath: 'inbox/source.sql',
        sourceRawHash: sha256(text),
        proposedCategory: 'customer',
        proposedOperationFolder: 'query',
        proposedFilename: 'find-user.sql',
        proposedDestination: destination,
        finalCategory: 'customer',
        finalOperationFolder: 'query',
        finalFilename: 'find-user.sql',
        finalDestination: destination,
        reason: 'test',
        confidence: 1,
        risk: 'read-only',
        status: 'approved',
        userModified: false,
        validationErrors: [],
      },
    ],
  });
  setup(async () => {
    await fs.rm(folder, { recursive: true, force: true });
    await fs.mkdir(path.join(folder, 'inbox'), { recursive: true });
  });
  teardown(async () => {
    await fs.rm(folder, { recursive: true, force: true });
  });

  test('moves only approved data, writes a manifest, and safely rolls back', async () => {
    const text = 'SELECT * FROM users WHERE id = :id;';
    const source = vscode.Uri.joinPath(root, 'inbox', 'source.sql');
    await vscode.workspace.fs.writeFile(source, Buffer.from(text));
    const repo = new Repository(root, config);
    const plan = makePlan(source, text);
    const manifest = await new PlanApplier(root, config, repo).apply(plan);
    const destination = vscode.Uri.joinPath(root, 'customer', 'query', 'find-user.sql');
    assert.equal(Buffer.from(await vscode.workspace.fs.readFile(destination)).toString(), text);
    assert.equal(manifest.result, 'success');
    assert.equal(manifest.moves.length, 1);
    assert.equal((await repo.lastManifest()).planId, 'test-plan');
    await rollbackLast(root, manifest);
    assert.equal(Buffer.from(await vscode.workspace.fs.readFile(source)).toString(), text);
    await assert.rejects(vscode.workspace.fs.stat(destination));
  });

  test('rejects a changed source before any rename', async () => {
    const original = 'SELECT 1;';
    const changed = 'SELECT 2;';
    const source = vscode.Uri.joinPath(root, 'inbox', 'source.sql');
    await vscode.workspace.fs.writeFile(source, Buffer.from(original));
    const plan = makePlan(source, original);
    await vscode.workspace.fs.writeFile(source, Buffer.from(changed));
    await assert.rejects(new PlanApplier(root, config, new Repository(root, config)).apply(plan), /Source changed/);
    await assert.rejects(vscode.workspace.fs.stat(vscode.Uri.joinPath(root, 'customer', 'query', 'find-user.sql')));
  });

  test('rejects traversal destinations before any rename', async () => {
    const text = 'SELECT 1;';
    const source = vscode.Uri.joinPath(root, 'inbox', 'source.sql');
    await vscode.workspace.fs.writeFile(source, Buffer.from(text));
    const plan = makePlan(source, text, '../escape.sql');
    await assert.rejects(new PlanApplier(root, config, new Repository(root, config)).apply(plan), /Unsafe destination/);
    assert.equal(Buffer.from(await vscode.workspace.fs.readFile(source)).toString(), text);
  });

  test('extracts an approved statement without modifying its mixed SQL source and rolls it back', async () => {
    const text = 'SELECT * FROM users;\nUPDATE bookings SET status = :status;';
    const source = vscode.Uri.joinPath(root, 'inbox', 'mixed.sql');
    await vscode.workspace.fs.writeFile(source, Buffer.from(text));
    const plan = makePlan(source, text, 'booking/dml/update-booking-status.sql');
    plan.actions[0].kind = 'extract';
    plan.actions[0].sourceStatementIndex = 1;
    const manifest = await new PlanApplier(root, config, new Repository(root, config)).apply(plan);
    const destination = vscode.Uri.joinPath(root, 'booking', 'dml', 'update-booking-status.sql');
    assert.equal(Buffer.from(await vscode.workspace.fs.readFile(source)).toString(), text);
    assert.equal(
      Buffer.from(await vscode.workspace.fs.readFile(destination)).toString(),
      '\nUPDATE bookings SET status = :status;',
    );
    assert.equal(manifest.writes.length, 1);
    await rollbackLast(root, manifest);
    await assert.rejects(vscode.workspace.fs.stat(destination));
    assert.equal(Buffer.from(await vscode.workspace.fs.readFile(source)).toString(), text);
  });

  test('appends approved SQL units into one module file and restores it on rollback', async () => {
    const first = 'SELECT * FROM bookings WHERE booking_id = :booking_id;';
    const second = 'UPDATE bookings SET status = :status WHERE booking_id = :booking_id;';
    const source = vscode.Uri.joinPath(root, 'inbox', 'booking.sql');
    await vscode.workspace.fs.writeFile(source, Buffer.from(first));
    const plan = makePlan(source, first, 'modules/booking.sql');
    plan.actions[0].kind = 'append';
    plan.actions[0].sourceUnitId = 'booking-read';
    const manifest = await new PlanApplier(root, config, new Repository(root, config)).apply(plan);
    const destination = vscode.Uri.joinPath(root, 'modules', 'booking.sql');
    assert.match(Buffer.from(await vscode.workspace.fs.readFile(destination)).toString(), /SELECT \* FROM bookings/);
    assert.equal(Buffer.from(await vscode.workspace.fs.readFile(source)).toString(), first);
    assert.equal((await new Repository(root, config).moduleIndex()).entries.length, 1);
    await rollbackLast(root, manifest);
    await assert.rejects(vscode.workspace.fs.stat(destination));
    assert.equal((await new Repository(root, config).moduleIndex()).entries.length, 0);
    await vscode.workspace.fs.writeFile(source, Buffer.from(second));
  });

  test('archives a complete organized source and restores it on rollback', async () => {
    const text = 'SELECT * FROM bookings WHERE booking_id = :booking_id;';
    const source = vscode.Uri.joinPath(root, 'inbox', 'booking.sql');
    await vscode.workspace.fs.writeFile(source, Buffer.from(text));
    const plan = makePlan(source, text, 'modules/booking.sql');
    Object.assign(plan.actions[0], {
      kind: 'append',
      sourceRelativePath: 'inbox/booking.sql',
      sourceUnitId: 'booking-read',
      sourceUnitRawHash: sha256(text),
      archiveSource: true,
      sourceUnitCount: 1,
    });
    assert.equal(plan.actions[0].archiveSource, true);
    assert.equal(plan.actions[0].sourceUnitCount, 1);
    const manifest = await new PlanApplier(root, config, new Repository(root, config)).apply(plan);
    const archive = manifest.moves.find((move) => move.source === 'inbox/booking.sql');
    assert.ok(archive);
    assert.match(archive.destination, /^archive\/organized\//);
    await assert.rejects(vscode.workspace.fs.stat(source));
    await rollbackLast(root, manifest);
    assert.equal(Buffer.from(await vscode.workspace.fs.readFile(source)).toString(), text);
  });

  test('blocks Apply when Git requires a clean worktree', async () => {
    const text = 'SELECT 1;';
    const source = vscode.Uri.joinPath(root, 'inbox', 'source.sql');
    await vscode.workspace.fs.writeFile(source, Buffer.from(text));
    await exec('git', ['init'], { cwd: folder });
    await exec('git', ['config', 'user.email', 'test@example.invalid'], { cwd: folder });
    await exec('git', ['config', 'user.name', 'SQL Organizer Test'], { cwd: folder });
    await exec('git', ['add', '.'], { cwd: folder });
    await exec('git', ['commit', '-m', 'fixture'], { cwd: folder });
    await fs.writeFile(path.join(folder, 'dirty.txt'), 'dirty');
    const guarded = JSON.parse(JSON.stringify(config));
    guarded.safety.requireCleanGitForApply = true;
    const plan = makePlan(source, text);
    plan.configHash = sha256(JSON.stringify(guarded));
    await assert.rejects(
      new PlanApplier(root, guarded, new Repository(root, guarded)).apply(plan),
      /Git working tree is dirty/,
    );
    assert.equal(Buffer.from(await vscode.workspace.fs.readFile(source)).toString(), text);
  });

  test('allows Apply when only SQL Organizer generated files are uncommitted', async () => {
    const text = 'SELECT 1;';
    const source = vscode.Uri.joinPath(root, 'inbox', 'source.sql');
    await vscode.workspace.fs.writeFile(source, Buffer.from(text));
    await exec('git', ['init'], { cwd: folder });
    await exec('git', ['config', 'user.email', 'test@example.invalid'], { cwd: folder });
    await exec('git', ['config', 'user.name', 'SQL Organizer Test'], { cwd: folder });
    await exec('git', ['add', '.'], { cwd: folder });
    await exec('git', ['commit', '-m', 'fixture'], { cwd: folder });
    await fs.mkdir(path.join(folder, '.sql-organizer'), { recursive: true });
    await fs.writeFile(path.join(folder, '.sql-organizer', 'plan.json'), '{}');
    await fs.writeFile(path.join(folder, 'SQL-ORGANIZER-REPORT.md'), '# Generated report\n');
    await fs.writeFile(path.join(folder, 'INDEX.md'), '# Generated index\n');
    await fs.mkdir(path.join(folder, 'modules'), { recursive: true });
    await fs.writeFile(path.join(folder, 'modules', 'booking.sql'), '-- generated module\n');
    const guarded = JSON.parse(JSON.stringify(config));
    guarded.safety.requireCleanGitForApply = true;
    const plan = makePlan(source, text);
    plan.configHash = sha256(JSON.stringify(guarded));
    const manifest = await new PlanApplier(root, guarded, new Repository(root, guarded)).apply(plan);
    assert.equal(manifest.result, 'success');
    assert.equal(
      Buffer.from(
        await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, 'customer', 'query', 'find-user.sql')),
      ).toString(),
      text,
    );
  });
});
