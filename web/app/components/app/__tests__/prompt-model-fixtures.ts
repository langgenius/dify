import type {
  DefaultModelResponse,
  ProviderWithModelsResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { consoleClient } from '@/service/console'

export const promptDefaultModel = {
  model: 'gpt-4.1',
  model_type: 'llm',
  provider: {
    provider: 'openai',
    provider_name: 'OpenAI',
    models: [],
    label: { en_US: 'OpenAI' },
    supported_model_types: ['llm'],
    tenant_id: 'workspace-1',
  },
} satisfies DefaultModelResponse

export const promptModelProviders = [
  {
    provider: 'openai',
    label: { en_US: 'OpenAI' },
    status: 'active',
    tenant_id: 'workspace-1',
    models: [
      {
        deprecated: false,
        has_invalid_load_balancing_configs: false,
        load_balancing_enabled: false,
        model: 'gpt-4.1',
        label: { en_US: 'GPT-4.1' },
        model_type: 'llm',
        fetch_from: 'predefined-model',
        status: 'active',
        model_properties: { mode: 'chat' },
      },
    ],
  },
] satisfies ProviderWithModelsResponse[]

export function mockPromptModelQueries({
  defaultModel,
  models,
}: {
  defaultModel: typeof consoleClient.workspaces.current.defaultModel.get
  models: typeof consoleClient.workspaces.current.models.modelTypes.byModelType.get
}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.origin,
    )
    if (url.pathname.endsWith('/workspaces/current/default-model'))
      return Response.json(await defaultModel({ query: { model_type: 'llm' } }))
    if (url.pathname.endsWith('/workspaces/current/models/model-types/llm'))
      return Response.json(await models({ params: { model_type: 'llm' } }))
    throw new Error(`Unexpected request: ${url.pathname}`)
  })
}
