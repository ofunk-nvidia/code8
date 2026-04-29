import * as vscode from 'vscode';
import { Code8Config } from './config';

const CACHE_KEY = 'code8.nimModelCatalog';
const DEFAULT_MODEL = 'meta/llama-3.3-70b-instruct';

export interface NimModel {
  readonly id: string;
  readonly source: 'provider' | 'docs' | 'configured';
  readonly ownedBy?: string;
}

interface CachedCatalog {
  readonly fetchedAt: number;
  readonly models: readonly NimModel[];
}

interface OpenAiModelsResponse {
  readonly data?: Array<{
    readonly id?: string;
    readonly owned_by?: string;
    readonly object?: string;
  }>;
}

export async function getNimModels(
  context: vscode.ExtensionContext,
  config: Code8Config,
  apiKey: string | undefined,
  forceRefresh = false
): Promise<readonly NimModel[]> {
  const cached = context.globalState.get<CachedCatalog>(CACHE_KEY);
  if (!forceRefresh && cached && isFresh(cached, config.modelCatalogCacheMinutes)) {
    return ensureConfiguredModel(cached.models, config.model);
  }

  const models = await fetchNimModels(config, apiKey);
  const normalized = ensureConfiguredModel(models, config.model);
  await context.globalState.update(CACHE_KEY, {
    fetchedAt: Date.now(),
    models: normalized
  } satisfies CachedCatalog);

  return normalized;
}

export async function fetchNimModels(config: Code8Config, apiKey: string | undefined): Promise<readonly NimModel[]> {
  const providerModels = await fetchProviderModels(config, apiKey).catch(() => []);
  if (providerModels.length > 0) {
    return providerModels;
  }

  const docsModels = await fetchDocsModels(config.modelCatalogUrl).catch(() => []);
  if (docsModels.length > 0) {
    return docsModels;
  }

  return [
    {
      id: DEFAULT_MODEL,
      source: 'configured'
    }
  ];
}

async function fetchProviderModels(config: Code8Config, apiKey: string | undefined): Promise<readonly NimModel[]> {
  const response = await fetch(`${config.baseUrl}/models`, {
    headers: apiKey
      ? {
          Authorization: `Bearer ${apiKey}`
        }
      : undefined
  });

  if (!response.ok) {
    throw new Error(`NVIDIA NIM model list failed: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as OpenAiModelsResponse;
  return dedupeModels(
    (body.data ?? [])
      .map((model) => ({
        id: normalizeModelId(model.id ?? ''),
        source: 'provider' as const,
        ownedBy: model.owned_by
      }))
      .filter((model) => model.id.length > 0)
  );
}

async function fetchDocsModels(catalogUrl: string): Promise<readonly NimModel[]> {
  const response = await fetch(catalogUrl);
  if (!response.ok) {
    throw new Error(`NVIDIA NIM docs catalog failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const linkText = [...html.matchAll(/>([^<>]+)</g)].map((match) => decodeHtml(match[1]));
  const candidates = linkText
    .map((text) => normalizeModelId(text))
    .filter((text) => /^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/i.test(text))
    .map((id) => ({
      id,
      source: 'docs' as const
    }));

  return dedupeModels(candidates);
}

function ensureConfiguredModel(models: readonly NimModel[], configuredModel: string): readonly NimModel[] {
  const id = normalizeModelId(configuredModel);
  if (!id || models.some((model) => model.id === id)) {
    return models;
  }

  return dedupeModels([
    {
      id,
      source: 'configured'
    },
    ...models
  ]);
}

function dedupeModels(models: readonly NimModel[]): readonly NimModel[] {
  const seen = new Set<string>();
  const result: NimModel[] = [];

  for (const model of models) {
    const id = normalizeModelId(model.id);
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    result.push({
      ...model,
      id
    });
  }

  return result.sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeModelId(value: string): string {
  return value
    .trim()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, '');
}

function isFresh(cached: CachedCatalog, cacheMinutes: number): boolean {
  if (cacheMinutes <= 0) {
    return false;
  }

  return Date.now() - cached.fetchedAt < cacheMinutes * 60_000;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/')
    .replace(/&nbsp;/g, ' ');
}

