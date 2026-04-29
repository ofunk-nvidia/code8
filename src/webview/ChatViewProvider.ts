import * as vscode from 'vscode';
import { CodingAgent } from '../agent/codingAgent';
import { getConfig } from '../config';
import { renderChatHtml } from './html';

interface WebviewMessage {
  readonly type: 'ready' | 'send' | 'setApiKey';
  readonly text?: string;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'code8.chatView';

  private view?: vscode.WebviewView;
  private running = false;

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
    await this.post('user', message.text);

    try {
      const agent = new CodingAgent({
        config: getConfig(),
        apiKey,
        emit: (event) => {
          void this.post(event.kind, event.text);
        }
      });
      await agent.run(message.text);
    } catch (error) {
      await this.post('error', error instanceof Error ? error.message : String(error));
    } finally {
      this.running = false;
      await this.postStatus();
    }
  }

  private async getApiKey(): Promise<string | undefined> {
    return this.context.secrets.get(this.ngcSecretKey) ?? process.env.NGC_API_KEY;
  }

  private async postStatus(): Promise<void> {
    const config = getConfig();
    const hasKey = Boolean(await this.getApiKey());
    await this.post('status', `Model: ${config.model} | NGC key: ${hasKey ? 'set' : 'missing'}`);
  }

  private async post(type: string, text: string): Promise<void> {
    await this.view?.webview.postMessage({ type, text });
  }
}

