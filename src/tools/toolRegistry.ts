import { AgentAction, AgentActionType } from '../agent/types';
import { Code8Config } from '../config';
import { WorkspaceTools } from './workspaceTools';

export type ToolMode = 'plan' | 'act' | 'both';
export type ToolApproval = 'never' | 'read' | 'write' | 'command';

export interface ToolDefinition {
  readonly name: AgentActionType;
  readonly description: string;
  readonly mode: ToolMode;
  readonly approval: ToolApproval;
  readonly mutatesWorkspace: boolean;
}

export interface ToolExecution {
  readonly definition: ToolDefinition;
  readonly result: string;
}

export class ToolRegistry {
  private readonly definitions = new Map<AgentActionType, ToolDefinition>();

  public constructor(private readonly workspaceTools: WorkspaceTools, private readonly config: Code8Config) {
    this.registerDefaults();
  }

  public describeForPrompt(): string {
    return [...this.definitions.values()]
      .map((tool) => `${tool.name}: ${tool.description} [mode=${tool.mode}, approval=${tool.approval}]`)
      .join('\n');
  }

  public async execute(action: AgentAction): Promise<ToolExecution> {
    const definition = this.get(action.action);
    if (definition.mode === 'act' && this.config.mode !== 'act') {
      return {
        definition,
        result: `Rejected by Code8 mode gate: ${definition.name} requires Act mode. Current mode is ${this.config.mode}.`
      };
    }

    return {
      definition,
      result: await this.workspaceTools.execute(action)
    };
  }

  public get(action: AgentActionType): ToolDefinition {
    const definition = this.definitions.get(action);
    if (!definition) {
      throw new Error(`Unsupported tool: ${action}`);
    }

    return definition;
  }

  private register(definition: ToolDefinition): void {
    this.definitions.set(definition.name, definition);
  }

  private registerDefaults(): void {
    this.register({
      name: 'list_files',
      description: 'List workspace files matching a glob.',
      mode: 'both',
      approval: 'read',
      mutatesWorkspace: false
    });
    this.register({
      name: 'read_file',
      description: 'Read a workspace file into context.',
      mode: 'both',
      approval: 'read',
      mutatesWorkspace: false
    });
    this.register({
      name: 'read_active_file',
      description: 'Read the active editor file and selection.',
      mode: 'both',
      approval: 'read',
      mutatesWorkspace: false
    });
    this.register({
      name: 'list_diagnostics',
      description: 'List VS Code workspace diagnostics.',
      mode: 'both',
      approval: 'never',
      mutatesWorkspace: false
    });
    this.register({
      name: 'write_file',
      description: 'Create or replace a file after diff review.',
      mode: 'act',
      approval: 'write',
      mutatesWorkspace: true
    });
    this.register({
      name: 'replace_in_file',
      description: 'Replace exact text in a file after diff review.',
      mode: 'act',
      approval: 'write',
      mutatesWorkspace: true
    });
    this.register({
      name: 'run_command',
      description: 'Run an approved command and return captured output.',
      mode: 'act',
      approval: 'command',
      mutatesWorkspace: false
    });
  }
}

