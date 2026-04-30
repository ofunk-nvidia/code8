import { WorkspaceTools } from '../tools/workspaceTools';
import { ToolRegistry } from '../tools/toolRegistry';
import { Code8Config } from '../config';
import { ChatMessage, createChatCompletion } from '../ngcProvider';
import { parseAgentAction } from './actionParser';
import { buildSystemPrompt } from './prompts';
import { AgentEventHandler } from './types';

export interface CodingAgentOptions {
  readonly config: Code8Config;
  readonly apiKey: string;
  readonly emit: AgentEventHandler;
}

export class CodingAgent {
  private readonly messages: ChatMessage[];

  public constructor(private readonly options: CodingAgentOptions) {
    this.messages = [
      {
        role: 'system',
        content: buildSystemPrompt(this.options.config.mode)
      }
    ];
  }

  public async run(userRequest: string, signal?: AbortSignal): Promise<void> {
    this.messages.push({
      role: 'user',
      content: userRequest
    });

    const tools = new ToolRegistry(new WorkspaceTools(this.options.config), this.options.config);
    if (!this.messages.some((message) => message.content.startsWith('Available tools:'))) {
      this.messages.push({
        role: 'system',
        content: `Available tools:\n${tools.describeForPrompt()}`
      });
    }

    for (let step = 1; step <= this.options.config.maxSteps; step += 1) {
      if (signal?.aborted) {
        this.options.emit({ kind: 'assistant', text: 'Stopped.' });
        return;
      }

      this.options.emit({ kind: 'status', text: `Step ${step}/${this.options.config.maxSteps}` });

      let streamed = '';
      const assistantText = await createChatCompletion({
        config: this.options.config,
        apiKey: this.options.apiKey,
        messages: this.messages,
        signal,
        onToken: (token) => {
          streamed += token;
          this.options.emit({ kind: 'token', text: token });
        }
      });

      const text = assistantText || streamed;
      const action = parseAgentAction(text);
      this.messages.push({ role: 'assistant', content: text });

      if (action.say) {
        this.options.emit({ kind: 'assistant', text: action.say });
      }

      if (action.action === 'respond') {
        return;
      }

      this.options.emit({
        kind: 'tool',
        title: action.action,
        status: 'running',
        text: action.say ?? `Running ${action.action}`
      });
      const execution = await tools.execute(action);
      this.options.emit({
        kind: 'tool',
        title: execution.definition.name,
        status: execution.result.startsWith('Rejected') || execution.result.includes('User rejected') ? 'rejected' : 'done',
        text: execution.result
      });
      this.messages.push({
        role: 'tool',
        content: `Result of ${execution.definition.name}:\n${execution.result}`
      });
    }

    this.options.emit({
      kind: 'assistant',
      text: 'I reached the configured step limit. Increase code8.agent.maxSteps or ask me to continue.'
    });
  }
}
