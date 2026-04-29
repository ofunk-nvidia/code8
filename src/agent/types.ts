export type AgentActionType = 'respond' | 'list_files' | 'read_file' | 'write_file' | 'replace_in_file' | 'run_command';

export interface AgentAction {
  readonly action: AgentActionType;
  readonly say?: string;
  readonly path?: string;
  readonly glob?: string;
  readonly content?: string;
  readonly oldText?: string;
  readonly newText?: string;
  readonly command?: string;
}

export interface AgentEvent {
  readonly kind: 'status' | 'assistant' | 'tool' | 'error' | 'token';
  readonly text: string;
}

export type AgentEventHandler = (event: AgentEvent) => void;

