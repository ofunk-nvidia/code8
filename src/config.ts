import * as vscode from 'vscode';

export interface Code8Config {
  readonly baseUrl: string;
  readonly model: string;
  readonly modelCatalogUrl: string;
  readonly modelCatalogCacheMinutes: number;
  readonly maxSteps: number;
  readonly autoApproveRead: boolean;
  readonly requireApprovalForWrites: boolean;
  readonly allowTerminalCommands: boolean;
}

export function getConfig(): Code8Config {
  const config = vscode.workspace.getConfiguration('code8');

  return {
    baseUrl: trimTrailingSlash(config.get('ngc.baseUrl', 'https://integrate.api.nvidia.com/v1')),
    model: config.get('ngc.model', 'meta/llama-3.3-70b-instruct'),
    modelCatalogUrl: config.get('ngc.modelCatalogUrl', 'https://docs.api.nvidia.com/nim/reference/models-1'),
    modelCatalogCacheMinutes: config.get('ngc.modelCatalogCacheMinutes', 60),
    maxSteps: config.get('agent.maxSteps', 8),
    autoApproveRead: config.get('agent.autoApproveRead', true),
    requireApprovalForWrites: config.get('agent.requireApprovalForWrites', true),
    allowTerminalCommands: config.get('agent.allowTerminalCommands', false)
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
