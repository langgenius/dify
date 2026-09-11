import type { DefaultModelResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { SessionModel } from '../types'
import type { consoleClient } from '@/service/console'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { consoleQuery } from '@/service/console'
import { commonQueryKeys } from '@/service/use-common'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import DifyBuilderComposer from '../composer'
import { createSessionView } from '../session/__tests__/fixtures'
import { difyBuilderSessionViewAtom } from '../session/state'
import { difyBuilderDraftAtom, difyBuilderSelectedModelAtom } from '../store'

vi.mock('@/service/common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/common')>()),
  fetchDefaultModal: vi.fn(() => new Promise(() => {})),
}))

const defaultModel: DefaultModelResponse = {
  model: 'gpt-4.1',
  model_type: 'llm',
  provider: {
    provider: 'openai',
    label: { en_US: 'OpenAI' },
    supported_model_types: ['llm'],
    tenant_id: 'workspace-1',
  },
}

type ModelList = Awaited<
  ReturnType<typeof consoleClient.workspaces.current.models.modelTypes.byModelType.get>
>['data']

const modelList: ModelList = [
  {
    provider: 'openai',
    label: { en_US: 'OpenAI' },
    status: 'active',
    tenant_id: 'workspace-1',
    models: ['gpt-4o', 'gpt-4.1'].map((model) => ({
      deprecated: false,
      has_invalid_load_balancing_configs: false,
      load_balancing_enabled: false,
      model,
      label: { en_US: model },
      model_type: 'llm',
      fetch_from: 'predefined-model',
      status: 'active',
      model_properties: { mode: 'chat' },
    })),
  },
]

const userModel: SessionModel = {
  provider: 'openai',
  name: 'gpt-4o',
  mode: 'chat',
  completion_params: {},
}

const renderSelector = ({
  configuredDefault = defaultModel,
  availableModels = modelList,
  defaultLoading = false,
  selectedModel,
  sessionModel,
}: {
  configuredDefault?: DefaultModelResponse | null
  availableModels?: ModelList
  defaultLoading?: boolean
  selectedModel?: SessionModel
  sessionModel?: SessionModel
} = {}) => {
  const queryClient = createConsoleQueryClient()
  const store = createStore()
  store.set(queryClientAtom, queryClient)
  store.set(difyBuilderDraftAtom, 'Build an expense assistant')
  if (selectedModel) store.set(difyBuilderSelectedModelAtom, selectedModel)
  if (sessionModel)
    store.set(
      difyBuilderSessionViewAtom,
      createSessionView({
        model: sessionModel,
        run_status: 'waiting_input',
        canvas_read_only: false,
      }),
    )
  if (!defaultLoading)
    queryClient.setQueryData(commonQueryKeys.defaultModel(ModelTypeEnum.textGeneration), {
      data: configuredDefault,
    })
  queryClient.setQueryData(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
      input: { params: { model_type: 'llm' } },
    }),
    { data: availableModels },
  )
  queryClient.setQueryData(consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(), {
    data: [],
    plugins: {},
  })
  queryClient.setQueryData(consoleQuery.workspaces.current.modelProviders.credits.get.queryKey(), {
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
    queryClient.setQueryData(commonQueryKeys.modelParameterRules('openai', model), { data: [] })
  const { wrapper: NuqsWrapper } = createNuqsTestWrapper()
  return renderWithConsoleQuery(
    <Provider store={store}>
      <NuqsWrapper>
        <DifyBuilderComposer />
      </NuqsWrapper>
    </Provider>,
    { queryClient },
  )
}

describe('DifyBuilderModelSelector', () => {
  beforeEach(() => vi.clearAllMocks())

  it('selects the system default model in both the trigger and model settings', async () => {
    const user = userEvent.setup()
    renderSelector()

    await user.click(screen.getByRole('button', { name: 'gpt-4.1' }))

    expect(
      screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' }),
    ).toHaveTextContent('gpt-4.1')
  })

  it('leaves the selector empty when no system default exists even if other models are available', async () => {
    const user = userEvent.setup()
    renderSelector({ configuredDefault: null })

    await user.click(screen.getByRole('button', { name: 'common.modelProvider.model' }))

    expect(
      screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' }),
    ).toHaveTextContent('plugin.detailPanel.configureModel')
    expect(screen.queryByText('gpt-4o')).not.toBeInTheDocument()
  })

  it.each(['missing', 'disabled', 'provider unavailable'])(
    'leaves the selector empty when the system default is %s',
    (availability) => {
      renderSelector({
        availableModels: modelList.map((provider) => ({
          ...provider,
          status: availability === 'provider unavailable' ? 'no-configure' : provider.status,
          models: provider.models
            .filter((model) => availability !== 'missing' || model.model !== defaultModel.model)
            .map((model) => ({
              ...model,
              status:
                availability === 'disabled' && model.model === defaultModel.model
                  ? 'disabled'
                  : model.status,
            })),
        })),
      })

      expect(screen.getByRole('button', { name: 'common.modelProvider.model' })).toBeInTheDocument()
    },
  )

  it('selects the system default after it loads', async () => {
    const { queryClient } = renderSelector({ defaultLoading: true })
    expect(screen.getByRole('button', { name: 'common.modelProvider.model' })).toBeInTheDocument()

    await act(async () => {
      queryClient.setQueryData(commonQueryKeys.defaultModel(ModelTypeEnum.textGeneration), {
        data: defaultModel,
      })
    })

    expect(await screen.findByRole('button', { name: 'gpt-4.1' })).toBeInTheDocument()
  })

  it('preserves a user selection when the system default loads', async () => {
    const { queryClient } = renderSelector({ defaultLoading: true, selectedModel: userModel })

    await act(async () => {
      queryClient.setQueryData(commonQueryKeys.defaultModel(ModelTypeEnum.textGeneration), {
        data: defaultModel,
      })
    })

    expect(screen.getByRole('button', { name: userModel.name })).toBeInTheDocument()
  })

  it('restores the existing session model instead of replacing it with the system default', () => {
    renderSelector({ sessionModel: userModel })

    expect(screen.getByRole('button', { name: userModel.name })).toBeInTheDocument()
  })

  it.each(['selected', 'session'])(
    'requires a new selection when the %s model becomes unavailable',
    (source) => {
      renderSelector({
        ...(source === 'selected' ? { selectedModel: userModel } : { sessionModel: userModel }),
        availableModels: modelList.map((provider) => ({
          ...provider,
          models: provider.models.map((model) => ({
            ...model,
            status: model.model === userModel.name ? 'disabled' : model.status,
          })),
        })),
      })

      expect(screen.getByRole('button', { name: userModel.name })).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' }),
      ).toBeDisabled()
      expect(
        screen.getByRole('textbox', { name: 'workflow.difyBuilder.messagePlaceholder' }),
      ).toBeEnabled()
      expect(
        screen.getByRole('textbox', { name: 'workflow.difyBuilder.messagePlaceholder' }),
      ).toHaveAccessibleDescription('workflow.workflowGenerator.modelRequired')
    },
  )
})
