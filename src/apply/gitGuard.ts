import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
const exec = promisify(execFile);
export interface GitState { isRepository: boolean; wasClean: boolean; }
export async function checkGit(root: vscode.Uri, requireRepository: boolean, requireClean: boolean): Promise<GitState> { try { const { stdout } = await exec('git', ['status', '--porcelain'], { cwd: root.fsPath, timeout: 5000 }); const state = { isRepository: true, wasClean: stdout.trim().length === 0 }; if (requireClean && !state.wasClean) throw new Error('Git working tree is dirty; Apply is blocked by configuration.'); return state; } catch (error) { if (error instanceof Error && error.message.includes('Git working tree')) throw error; if (requireRepository) throw new Error('A Git repository is required for Apply.'); return { isRepository: false, wasClean: false }; } }
