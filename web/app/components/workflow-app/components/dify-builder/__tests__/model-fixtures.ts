import type {
  DefaultModelResponse,
  ModelProviderSummaryResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import type { SessionModel } from '../types'
import type { consoleClient } from '@/service/console'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { consoleQuery } from '@/service/console'
import { commonQueryKeys } from '@/service/use-common'
import { createConsoleQueryClient } from '@/test/console/query-data'

export const builderModel: SessionModel = {
  provider: 'openai',
  name: 'gpt-4.1',
  mode: 'chat',
  completion_params: {},
}

export const builderDefaultModel: DefaultModelResponse = {
  model: builderModel.name,
  model_type: 'llm',
  provider: {
    provider: builderModel.provider,
    label: { en_US: 'OpenAI' },
    supported_model_types: ['llm'],
    tenant_id: 'workspace-1',
  },
}

type ModelList = Awaited<
  ReturnType<typeof consoleClient.workspaces.current.models.modelTypes.byModelType.get>
>['data']

export const builderModelList: ModelList = [
  {
    ...builderDefaultModel.provider,
    status: 'active',
    models: ['gpt-4.1', 'gpt-4o'].map((model) => ({
      model,
      label: { en_US: model },
      model_type: 'llm',
      status: 'active',
      model_properties: { mode: 'chat' },
      deprecated: false,
      fetch_from: 'predefined-model',
      has_invalid_load_balancing_configs: false,
      load_balancing_enabled: false,
    })),
  },
]

export const builderModelListQueryKey =
  consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
    input: { params: { model_type: ModelTypeEnum.textGeneration } },
  })

export const createBuilderQueryClient = ({
  defaultModel = builderDefaultModel,
  models = builderModelList,
  defaultLoading = false,
  modelsLoading = false,
}: {
  defaultModel?: DefaultModelResponse | null
  models?: ModelList
  defaultLoading?: boolean
  modelsLoading?: boolean
} = {}): QueryClient => {
  const client = createConsoleQueryClient()
  if (!defaultLoading)
    client.setQueryData(commonQueryKeys.defaultModel(ModelTypeEnum.textGeneration), {
      data: defaultModel,
    })
  if (modelsLoading)
    void client.query({ queryKey: builderModelListQueryKey, queryFn: () => new Promise(() => {}) })
  else client.setQueryData(builderModelListQueryKey, { data: models })
  for (const model_type of ['text-embedding', 'rerank', 'speech2text', 'tts'] as const)
    client.setQueryData(
      consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
        input: { params: { model_type } },
      }),
      { data: [] },
    )
  client.setQueryData(consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(), {
    data: [
      {
        provider: 'openai',
        plugin_id: 'langgenius/openai',
        label: { en_US: 'OpenAI' },
        configurate_methods: ['predefined-model'],
        supported_model_types: ['llm'],
        preferred_provider_type: 'custom',
        is_configured: true,
        system_configuration: { enabled: false },
        custom_configuration: {
          status: 'active',
          available_credentials: [],
          current_credential_usable: true,
          has_custom_models: false,
        },
      } satisfies ModelProviderSummaryResponse,
    ],
    plugins: {},
  })
  client.setQueryData(consoleQuery.workspaces.current.modelProviders.credits.get.queryKey(), {
    exhausted_at: null,
    is_exhausted: false,
    is_unlimited: false,
    next_credit_reset_date: null,
    pool_type: 'trial',
    quota_limit: 100,
    quota_used: 0,
    remaining_credits: 100,
  })
  for (const model of ['gpt-4o', 'gpt-4.1'])
    client.setQueryData(commonQueryKeys.modelParameterRules('openai', model), { data: [] })
  return client
}
