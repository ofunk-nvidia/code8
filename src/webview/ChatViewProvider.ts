import * as vscode from 'vscode';
import { CodingAgent } from '../agent/codingAgent';
import { getConfig } from '../config';
import { getNimModels, NimModel } from '../nimCatalog';
import { renderChatHtml } from './html';

interface WebviewMessage {
  readonly type: 'ready' | 'send' | 'setApiKey' | 'selectModel' | 'refreshModels' | 'toggleMode' | 'stop' | 'reset';
  readonly text?: string;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'code8.chatView';

  private view?: vscode.WebviewView;
  private running = false;
  private agent?: CodingAgent;
  private agentIdentity?: string;
  private abortController?: AbortController;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly ngcSecretKey: string
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true
    };
    webviewView.webview.html = renderChatHtml(webviewView.webview, this.context.extensionUri);

    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
      void this.handleMessage(message);
    });
  }

  public refreshStatus(): void {
    void this.postStatus();
  }

  public async toggleAgentMode(): Promise<void> {
    const current = getConfig().mode;
    const next = current === 'plan' ? 'act' : 'plan';
    await vscode.workspace.getConfiguration('code8').update('agent.mode', next, vscode.ConfigurationTarget.Global);
    this.resetAgentSession();
    await this.post('assistant', `Switched to ${next.toUpperCase()} mode.`);
    await this.postStatus();
  }

  public async selectNimModel(): Promise<void> {
    const config = getConfig();
    const apiKey = await this.getApiKey();
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Loading NVIDIA NIM model catalog'
      },
      async () => {
        const models = await getNimModels(this.context, config, apiKey);
        const selected = await vscode.window.showQuickPick(
          models.map((model) => toQuickPickItem(model, config.model)),
          {
            title: 'Select NVIDIA NIM model for Code8',
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: 'Search hosted NIM model IDs'
          }
        );

        if (!selected) {
          return;
        }

        await vscode.workspace
          .getConfiguration('code8')
          .update('ngc.model', selected.model.id, vscode.ConfigurationTarget.Global);
        this.resetAgentSession();
        await this.post('assistant', `Model switched to ${selected.model.id}.`);
        await this.postStatus();
      }
    );
  }

  public async refreshModelCatalog(): Promise<void> {
    const config = getConfig();
    const apiKey = await this.getApiKey();
    const models = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Refreshing NVIDIA NIM model catalog'
      },
      () => getNimModels(this.context, config, apiKey, true)
    );
    await this.post('assistant', `Refreshed ${models.length} NIM models.`);
    await this.postStatus();
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    if (message.type === 'ready') {
      await this.postStatus();
      return;
    }

    if (message.type === 'setApiKey') {
      await vscode.commands.executeCommand('code8.setNgcApiKey');
      await this.postStatus();
      return;
    }

    if (message.type === 'selectModel') {
      await this.selectNimModel();
      return;
    }

    if (message.type === 'refreshModels') {
      await this.refreshModelCatalog();
      return;
    }

    if (message.type === 'toggleMode') {
      await this.toggleAgentMode();
      return;
    }

    if (message.type === 'stop') {
      this.abortController?.abort();
      await this.post('assistant', 'Stop requested.');
      return;
    }

    if (message.type === 'reset') {
      this.resetAgentSession();
      await this.post('assistant', 'Started a new agent session.');
      await this.postStatus();
      return;
    }

    if (message.type !== 'send' || !message.text?.trim()) {
      return;
    }

    if (this.running) {
      await this.post('error', 'Code8 is already working on a request.');
      return;
    }

    const apiKey = await this.getApiKey();
    if (!apiKey) {
      await this.post('error', 'Set your NVIDIA NGC API key first.');
      return;
    }

    this.running = true;
    this.abortController = new AbortController();
    await this.post('user', message.text);

    try {
      const agent = this.getAgent(apiKey);
      await agent.run(message.text, this.abortController.signal);
    } catch (error) {
      if (this.abortController.signal.aborted) {
        await this.post('assistant', 'Stopped.');
      } else {
        await this.post('error', error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.running = false;
      this.abortController = undefined;
      await this.postStatus();
    }
  }

  private async getApiKey(): Promise<string | undefined> {
    return this.context.secrets.get(this.ngcSecretKey) ?? process.env.NGC_API_KEY;
  }

  private async postStatus(): Promise<void> {
    const config = getConfig();
    const hasKey = Boolean(await this.getApiKey());
    await this.post('status', `${config.mode.toUpperCase()} | ${config.model} | NGC key: ${hasKey ? 'set' : 'missing'} | ${this.running ? 'working' : 'ready'}`);
  }

  private async post(type: string, text: string, title?: string, status?: string): Promise<void> {
    await this.view?.webview.postMessage({ type, text, title, status });
  }

  private getAgent(apiKey: string): CodingAgent {
    const config = getConfig();
    const identity = JSON.stringify({
      baseUrl: config.baseUrl,
      model: config.model,
      maxSteps: config.maxSteps,
      mode: config.mode,
      autoApproveRead: config.autoApproveRead,
      requireApprovalForWrites: config.requireApprovalForWrites,
      allowTerminalCommands: config.allowTerminalCommands
    });

    if (!this.agent || this.agentIdentity !== identity) {
      this.agent = new CodingAgent({
        config,
        apiKey,
        emit: (event) => {
          void this.post(event.kind, event.text, event.title, event.status);
        }
      });
      this.agentIdentity = identity;
    }

    return this.agent;
  }

  private resetAgentSession(): void {
    this.abortController?.abort();
    this.agent = undefined;
    this.agentIdentity = undefined;
  }
}

interface ModelQuickPickItem extends vscode.QuickPickItem {
  readonly model: NimModel;
}

function toQuickPickItem(model: NimModel, currentModel: string): ModelQuickPickItem {
  const current = model.id === currentModel ? 'current' : undefined;
  const source = model.source === 'provider' ? 'provider list' : model.source === 'docs' ? 'NVIDIA docs catalog' : 'configured';

  return {
    label: model.id,
    description: [current, model.ownedBy].filter(Boolean).join(' | '),
    detail: source,
    model
  };
}
