import * as path from 'path';
import * as vscode from 'vscode';
import { AgentAction } from '../agent/types';
import { Code8Config } from '../config';

const MAX_READ_BYTES = 60_000;
const MAX_LIST_RESULTS = 200;

export class WorkspaceTools {
  public constructor(private readonly config: Code8Config) {}

  public async execute(action: AgentAction): Promise<string> {
    switch (action.action) {
      case 'list_files':
        return this.listFiles(action.glob ?? '**/*');
      case 'read_file':
        return this.readFile(required(action.path, 'path'));
      case 'read_active_file':
        return this.readActiveFile();
      case 'list_diagnostics':
        return this.listDiagnostics();
      case 'write_file':
        return this.writeFile(required(action.path, 'path'), action.content ?? '');
      case 'replace_in_file':
        return this.replaceInFile(required(action.path, 'path'), required(action.oldText, 'oldText'), action.newText ?? '');
      case 'run_command':
        return this.runCommand(required(action.command, 'command'));
      case 'respond':
        return action.say ?? '';
      default:
        return `Unsupported action: ${(action as AgentAction).action}`;
    }
  }

  private async listFiles(glob: string): Promise<string> {
    if (!this.config.autoApproveRead && !(await confirm('Allow Code8 to list workspace files?'))) {
      return 'User rejected file listing.';
    }

    const files = await vscode.workspace.findFiles(glob, '**/{node_modules,out,dist,.git}/**', MAX_LIST_RESULTS);
    return files.map((uri) => vscode.workspace.asRelativePath(uri)).join('\n') || 'No files matched.';
  }

  private async readFile(relativePath: string): Promise<string> {
    if (!this.config.autoApproveRead && !(await confirm(`Allow Code8 to read ${relativePath}?`))) {
      return `User rejected reading ${relativePath}.`;
    }

    const uri = resolveWorkspaceUri(relativePath);
    const bytes = await vscode.workspace.fs.readFile(uri);
    const content = new TextDecoder().decode(bytes.slice(0, MAX_READ_BYTES));
    const truncated = bytes.byteLength > MAX_READ_BYTES ? '\n\n[File truncated for context window.]' : '';
    return content + truncated;
  }

  private async readActiveFile(): Promise<string> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return 'No active editor is open.';
    }

    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!folder) {
      return 'The active file is not inside the current workspace.';
    }

    if (!this.config.autoApproveRead && !(await confirm(`Allow Code8 to read ${vscode.workspace.asRelativePath(editor.document.uri)}?`))) {
      return 'User rejected reading the active file.';
    }

    const text = editor.document.getText();
    const content = text.length > MAX_READ_BYTES ? `${text.slice(0, MAX_READ_BYTES)}\n\n[File truncated for context window.]` : text;
    const selection = editor.selection.isEmpty ? '' : `\n\n[Selection]\n${editor.document.getText(editor.selection)}`;
    return `[Active file: ${vscode.workspace.asRelativePath(editor.document.uri)}]\n${content}${selection}`;
  }

  private async listDiagnostics(): Promise<string> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return 'Open a workspace folder before listing diagnostics.';
    }

    const results: string[] = [];
    for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
      if (!isInsideWorkspace(folder.uri.fsPath, uri.fsPath)) {
        continue;
      }

      for (const diagnostic of diagnostics) {
        const line = diagnostic.range.start.line + 1;
        const character = diagnostic.range.start.character + 1;
        const severity = vscode.DiagnosticSeverity[diagnostic.severity];
        const source = diagnostic.source ? ` [${diagnostic.source}]` : '';
        results.push(`${vscode.workspace.asRelativePath(uri)}:${line}:${character} ${severity}${source}: ${diagnostic.message}`);
        if (results.length >= 100) {
          return `${results.join('\n')}\n\n[Diagnostics truncated at 100 entries.]`;
        }
      }
    }

    return results.join('\n') || 'No workspace diagnostics reported by VS Code.';
  }

  private async writeFile(relativePath: string, content: string): Promise<string> {
    if (this.config.requireApprovalForWrites && !(await confirm(`Allow Code8 to write ${relativePath}?`))) {
      return `User rejected writing ${relativePath}.`;
    }

    const uri = resolveWorkspaceUri(relativePath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    return `Wrote ${relativePath}.`;
  }

  private async replaceInFile(relativePath: string, oldText: string, newText: string): Promise<string> {
    if (this.config.requireApprovalForWrites && !(await confirm(`Allow Code8 to edit ${relativePath}?`))) {
      return `User rejected editing ${relativePath}.`;
    }

    const uri = resolveWorkspaceUri(relativePath);
    const original = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    if (!original.includes(oldText)) {
      return `Could not edit ${relativePath}: oldText was not found.`;
    }

    const updated = original.replace(oldText, newText);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updated));
    return `Edited ${relativePath}.`;
  }

  private async runCommand(command: string): Promise<string> {
    if (!this.config.allowTerminalCommands) {
      return 'Terminal commands are disabled by code8.agent.allowTerminalCommands.';
    }

    if (!(await confirm(`Run terminal command?\n\n${command}`))) {
      return `User rejected command: ${command}`;
    }

    const terminal = vscode.window.createTerminal('Code8 Agent');
    terminal.show();
    terminal.sendText(command);
    return `Started command in terminal: ${command}`;
  }
}

function resolveWorkspaceUri(relativePath: string): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error('Open a workspace folder before using Code8.');
  }

  const target = vscode.Uri.joinPath(folder.uri, relativePath);
  if (!isInsideWorkspace(folder.uri.fsPath, target.fsPath)) {
    throw new Error(`Refusing to access path outside workspace: ${relativePath}`);
  }

  return target;
}

function isInsideWorkspace(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Agent action is missing ${name}.`);
  }

  return value;
}

async function confirm(message: string): Promise<boolean> {
  const result = await vscode.window.showWarningMessage(message, { modal: true }, 'Allow');
  return result === 'Allow';
}
