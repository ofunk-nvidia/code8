import { AgentAction } from './types';

export function parseAgentAction(text: string): AgentAction {
  const trimmed = stripCodeFence(text.trim());
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');

  if (start === -1 || end === -1 || end < start) {
    return {
      action: 'respond',
      say: text.trim()
    };
  }

  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Partial<AgentAction>;
    if (!parsed.action) {
      return { action: 'respond', say: text.trim() };
    }

    return parsed as AgentAction;
  } catch {
    return {
      action: 'respond',
      say: text.trim()
    };
  }
}

function stripCodeFence(value: string): string {
  return value
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
}

