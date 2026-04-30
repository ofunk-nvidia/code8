import * as vscode from 'vscode';
import { ChatViewProvider } from './webview/ChatViewProvider';

const NGC_SECRET_KEY = 'code8.ngc.apiKey';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ChatViewProvider(context, NGC_SECRET_KEY);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider),
    vscode.commands.registerCommand('code8.openChat', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.code8');
    }),
    vscode.commands.registerCommand('code8.toggleAgentMode', async () => {
      await provider.toggleAgentMode();
    }),
    vscode.commands.registerCommand('code8.selectNimModel', async () => {
      await provider.selectNimModel();
    }),
    vscode.commands.registerCommand('code8.refreshNimModels', async () => {
      await provider.refreshModelCatalog();
    }),
    vscode.commands.registerCommand('code8.setNgcApiKey', async () => {
      const value = await vscode.window.showInputBox({
        title: 'Set NVIDIA NGC API Key',
        prompt: 'Stored in VS Code SecretStorage, not in settings or the repository.',
        password: true,
        ignoreFocusOut: true
      });

      if (!value) {
        return;
      }

      await context.secrets.store(NGC_SECRET_KEY, value.trim());
      await vscode.window.showInformationMessage('Code8 NGC API key saved.');
      provider.refreshStatus();
    }),
    vscode.commands.registerCommand('code8.clearNgcApiKey', async () => {
      await context.secrets.delete(NGC_SECRET_KEY);
      await vscode.window.showInformationMessage('Code8 NGC API key cleared.');
      provider.refreshStatus();
    })
  );
}

export function deactivate(): void {
  // VS Code disposes subscriptions registered in activate.
}
