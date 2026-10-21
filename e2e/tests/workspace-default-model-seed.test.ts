import type {
  AvailableModelListResponse,
  DefaultModelResponse,
  ModelType,
  ParserPostDefault,
  ProviderModelWithStatusEntity,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ConsoleClient } from '../support/api/console-client.ts'
import { consoleRouterContract } from '@dify/contracts/api/console/router.gen'
import {
  zModelType,
  zPostWorkspacesCurrentDefaultModelBody,
} from '@dify/contracts/api/console/workspaces/zod.gen'
import { createORPCClient } from '@orpc/client'
import { RequestValidationPlugin, ResponseValidationPlugin } from '@orpc/contract/plugins'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createAgentV2SeedTasks } from '../features/agent-v2/support/seed.ts'

const provider = 'langgenius/openai/openai'
const tenantId = '00000000-0000-4000-8000-000000000001'

const defaultModel = (modelType: ModelType, model: string): DefaultModelResponse => ({
  model,
  model_type: modelType,
  provider: {
    label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
    provider,
    supported_model_types: [modelType],
    tenant_id: tenantId,
  },
})

const availableModel = (modelType: ModelType, model: string): ProviderModelWithStatusEntity => ({
  fetch_from: 'predefined-model',
  label: { en_US: model, zh_Hans: model },
  model,
  model_properties: {},
  model_type: modelType,
  status: 'active',
})

const createSeedApi = ({
  initialDefaults = [],
  models = [
    availableModel('llm', 'gpt-5-nano'),
    availableModel('speech2text', 'gpt-4o-mini-transcribe'),
  ],
  persist = true,
}: {
  initialDefaults?: DefaultModelResponse[]
  models?: ProviderModelWithStatusEntity[]
  persist?: boolean
} = {}) => {
  const defaults = new Map(initialDefaults.map((model) => [model.model_type, model]))
  const writes: ParserPostDefault[] = []
  const link = new OpenAPILink(consoleRouterContract, {
    url: 'http://seed.test/console/api',
    plugins: [
      new RequestValidationPlugin(consoleRouterContract),
      new ResponseValidationPlugin(consoleRouterContract),
    ],
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname === '/console/api/workspaces/current/default-model') {
        if (request.method === 'GET') {
          const modelType = zModelType.parse(url.searchParams.get('model_type'))
          return Response.json({ data: defaults.get(modelType) ?? null })
        }
        if (request.method === 'POST') {
          const body = zPostWorkspacesCurrentDefaultModelBody.parse(await request.json())
          writes.push(body)
          if (persist) {
            // Match the API's replacement semantics, including deletion of omitted types.
            defaults.clear()
            for (const setting of body.model_settings) {
              if (!setting.model || !setting.provider) continue
              const model = defaultModel(setting.model_type, setting.model)
              model.provider.provider = setting.provider
              defaults.set(setting.model_type, model)
            }
          }
          return Response.json({ result: 'success' })
        }
      }
      const modelTypesPath = '/console/api/workspaces/current/models/model-types/'
      if (request.method === 'GET' && url.pathname.startsWith(modelTypesPath)) {
        const modelType = zModelType.parse(url.pathname.slice(modelTypesPath.length))
        const response: AvailableModelListResponse = {
          data: [
            {
              label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
              models: models.filter((model) => model.model_type === modelType),
              provider,
              status: 'active',
              tenant_id: tenantId,
            },
          ],
        }
        return Response.json(response)
      }
      throw new Error(`Unexpected seed request: ${request.method} ${url.pathname}`)
    },
  })
  const consoleClient = createORPCClient<ConsoleClient>(link)
  const run = (profile = 'post-merge', dryRun = false) => {
    const task = createAgentV2SeedTasks(profile).find(
      (task) => task.id === 'workspace-default-models',
    )
    if (!task) throw new Error(`No workspace default model seed in ${profile}`)
    return task.run({ consoleClient, dryRun, resources: new Map() })
  }
  return { defaults, run, writes }
}

describe('workspace default model seed', () => {
  beforeEach(() => {
    vi.stubEnv('E2E_STABLE_MODEL_NAME', 'gpt-5-nano')
    vi.stubEnv('E2E_STABLE_MODEL_PROVIDER', 'openai')
    vi.stubEnv('E2E_STABLE_MODEL_TYPE', 'llm')
    vi.stubEnv('E2E_SPEECH_TO_TEXT_MODEL_NAME', 'gpt-4o-mini-transcribe')
    vi.stubEnv('E2E_SPEECH_TO_TEXT_MODEL_PROVIDER', 'openai')
  })

  afterEach(() => vi.unstubAllEnvs())

  it.each(['post-merge', 'external-runtime'])(
    'saves chat and speech defaults together for %s and is idempotent',
    async (profile) => {
      const api = createSeedApi({
        initialDefaults: [defaultModel('text-embedding', 'text-embedding-3-small')],
      })

      expect((await api.run(profile)).status).toBe('updated')
      expect(api.writes).toHaveLength(1)
      expect(api.defaults.get('llm')?.model).toBe('gpt-5-nano')
      expect(api.defaults.get('speech2text')?.model).toBe('gpt-4o-mini-transcribe')
      expect(api.defaults.get('text-embedding')?.model).toBe('text-embedding-3-small')
      expect((await api.run(profile)).status).toBe('verified')
      expect(api.writes).toHaveLength(1)
    },
  )

  it('configures the prepared chat default without changing an existing speech default', async () => {
    const api = createSeedApi({
      initialDefaults: [
        defaultModel('llm', 'old-chat-model'),
        defaultModel('speech2text', 'whisper-1'),
      ],
      models: [availableModel('llm', 'gpt-5-nano')],
    })

    expect((await api.run('prepared')).status).toBe('updated')
    expect(api.defaults.get('llm')?.model).toBe('gpt-5-nano')
    expect(api.defaults.get('speech2text')?.model).toBe('whisper-1')
  })

  it('honors the configured stable model instead of assuming the first available model', async () => {
    vi.stubEnv('E2E_STABLE_MODEL_NAME', 'gpt-5.5')
    const api = createSeedApi({
      models: [availableModel('llm', 'gpt-5-nano'), availableModel('llm', 'gpt-5.5')],
    })

    expect((await api.run('prepared')).status).toBe('updated')
    expect(api.defaults.get('llm')?.model).toBe('gpt-5.5')
  })

  it.each([undefined, 'no-configure'] as const)(
    'blocks missing or inactive speech models before writing any defaults (%s)',
    async (status) => {
      const models = [availableModel('llm', 'gpt-5-nano')]
      if (status)
        models.push({ ...availableModel('speech2text', 'gpt-4o-mini-transcribe'), status })
      const api = createSeedApi({ models })

      expect((await api.run()).status).toBe('blocked')
      expect(api.writes).toHaveLength(0)
    },
  )

  it('does not mutate workspace defaults during a dry run', async () => {
    const api = createSeedApi()

    expect((await api.run('post-merge', true)).status).toBe('skipped')
    expect(api.writes).toHaveLength(0)
    expect(api.defaults.size).toBe(0)
  })

  it('fails readiness when a successful save does not persist the requested defaults', async () => {
    const api = createSeedApi({ persist: false })

    expect(await api.run()).toEqual(
      expect.objectContaining({
        reason: expect.stringContaining('was not saved'),
        status: 'blocked',
      }),
    )
  })

  it('rejects a non-LLM stable model configuration', async () => {
    vi.stubEnv('E2E_STABLE_MODEL_TYPE', 'text-embedding')
    const api = createSeedApi()

    expect(await api.run('prepared')).toEqual(
      expect.objectContaining({
        reason: expect.stringContaining('must be llm'),
        status: 'blocked',
      }),
    )
    expect(api.writes).toHaveLength(0)
  })
})
