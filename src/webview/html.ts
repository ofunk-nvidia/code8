import * as vscode from 'vscode';

export function renderChatHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'code8.svg'));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <title>Code8</title>
  <style>
    :root {
      color-scheme: light dark;
    }

    body {
      margin: 0;
      padding: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .shell {
      display: grid;
      grid-template-rows: auto 1fr auto;
      height: 100vh;
      min-height: 0;
    }

    header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
    }

    header img {
      width: 22px;
      height: 22px;
    }

    header strong {
      font-size: 13px;
      font-weight: 600;
    }

    #status {
      margin-left: auto;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-align: right;
    }

    #log {
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .message {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 8px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      line-height: 1.45;
    }

    .user {
      background: var(--vscode-inputValidation-infoBackground);
      border-color: var(--vscode-inputValidation-infoBorder);
    }

    .assistant,
    .tool,
    .status {
      background: var(--vscode-editor-background);
    }

    .error {
      background: var(--vscode-inputValidation-errorBackground);
      border-color: var(--vscode-inputValidation-errorBorder);
    }

    .token {
      display: none;
    }

    form {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      padding: 10px;
      border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
    }

    textarea {
      min-height: 54px;
      max-height: 180px;
      resize: vertical;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      padding: 8px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    button {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: 0;
      border-radius: 4px;
      padding: 8px 10px;
      cursor: pointer;
      min-width: 72px;
    }

    button.secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }

    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <img src="${iconUri}" alt="">
      <strong>Code8</strong>
      <span id="status">Starting...</span>
    </header>
    <section id="log" aria-live="polite"></section>
    <form id="composer">
      <textarea id="prompt" placeholder="Ask Code8 to inspect, edit, or explain this workspace"></textarea>
      <div class="actions">
        <button type="submit">Send</button>
        <button class="secondary" type="button" id="key">Key</button>
      </div>
    </form>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const log = document.getElementById('log');
    const status = document.getElementById('status');
    const form = document.getElementById('composer');
    const prompt = document.getElementById('prompt');
    const key = document.getElementById('key');

    function append(type, text) {
      if (type === 'status') {
        status.textContent = text;
        return;
      }

      const el = document.createElement('article');
      el.className = 'message ' + type;
      el.textContent = text;
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
    }

    window.addEventListener('message', (event) => {
      const { type, text } = event.data;
      append(type, text);
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = prompt.value.trim();
      if (!text) {
        return;
      }
      prompt.value = '';
      vscode.postMessage({ type: 'send', text });
    });

    key.addEventListener('click', () => {
      vscode.postMessage({ type: 'setApiKey' });
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

function getNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}

