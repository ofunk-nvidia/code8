import { Code8Config } from './config';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
}

export interface ChatCompletionOptions {
  readonly config: Code8Config;
  readonly apiKey: string;
  readonly messages: readonly ChatMessage[];
  readonly onToken?: (token: string) => void;
}

interface NvidiaChatCompletionChunk {
  readonly choices?: Array<{
    readonly delta?: {
      readonly content?: string;
    };
    readonly message?: {
      readonly content?: string;
    };
  }>;
}

export async function createChatCompletion(options: ChatCompletionOptions): Promise<string> {
  const body = {
    model: options.config.model,
    messages: options.messages,
    temperature: 0.2,
    top_p: 0.7,
    max_tokens: 2048,
    stream: true
  };

  const response = await fetch(`${options.config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`NVIDIA NGC request failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`);
  }

  if (!response.body) {
    throw new Error('NVIDIA NGC response did not include a readable body.');
  }

  return readServerSentEvents(response.body, options.onToken);
}

async function readServerSentEvents(body: ReadableStream<Uint8Array>, onToken?: (token: string) => void): Promise<string> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) {
        continue;
      }

      const data = trimmed.slice('data:'.length).trim();
      if (data === '[DONE]') {
        return fullText;
      }

      try {
        const chunk = JSON.parse(data) as NvidiaChatCompletionChunk;
        const token = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? '';
        if (token) {
          fullText += token;
          onToken?.(token);
        }
      } catch {
        // Ignore malformed SSE fragments and continue reading the stream.
      }
    }
  }

  return fullText;
}

