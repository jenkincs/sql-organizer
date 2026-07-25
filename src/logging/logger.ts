import * as vscode from 'vscode';

export class Logger implements vscode.Disposable {
  private readonly channel = vscode.window.createOutputChannel('SQL Organizer');
  private level: 'error' | 'warn' | 'info' | 'debug' = 'info';
  setLevel(level: typeof this.level): void { this.level = level; }
  error(message: string): void { this.write('error', message); }
  warn(message: string): void { this.write('warn', message); }
  info(message: string): void { this.write('info', message); }
  debug(message: string): void { this.write('debug', message); }
  show(): void { this.channel.show(true); }
  dispose(): void { this.channel.dispose(); }
  private write(level: typeof this.level, message: string): void {
    if (['error', 'warn', 'info', 'debug'].indexOf(level) > ['error', 'warn', 'info', 'debug'].indexOf(this.level)) return;
    this.channel.appendLine(`[${new Date().toISOString()}] ${level.toUpperCase()} ${message.replace(/(sk-[A-Za-z0-9_-]+|Bearer\\s+[^\\s]+)/g, '[REDACTED]')}`);
  }
}
