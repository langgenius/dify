import type { ProviderWithModelsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { AgentComposerModel } from '@/features/agent-v2/agent-composer/form-state'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentModelField } from '../field'

const providerSummary = vi.hoisted(() => vi.fn())

const modelList = vi.hoisted(() => vi.fn<() => Promise<{ data: ProviderWithModelsResponse[] }>>())

vi.mock('nuqs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('nuqs')>()),
  useQueryState: () => [null, vi.fn()],
}))

vi.mock('@/service/use-common', () => ({
  useModelParameterRules: () => ({ data: { data: [] }, isLoading: false }),
}))

vi.mock(
  '@/app/components/header/account-setting/model-provider-page/provider-added-card/use-credential-panel-state',
  () => ({
    useCredentialPanelState: () => ({ variant: 'api-unavailable', hasCredentials: false }),
  }),
)

vi.mock('@/service/console', () => ({
  consoleQuery: {
    workspaces: {
      current: {
        models: {
          modelTypes: {
            byModelType: {
              get: {
                queryOptions: (options: object) => ({
                  queryKey: ['model-list'],
                  queryFn: modelList,
                  ...options,
                }),
              },
            },
          },
        },
        modelProviders: {
          summary: {
            get: {
              queryOptions: (options: object) => ({
                queryKey: ['providers'],
                queryFn: providerSummary,
                ...options,
              }),
            },
          },
        },
      },
    },
  },
}))

function renderField(currentModel?: AgentComposerModel) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const onSelect = vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <AgentModelField currentModel={currentModel} onSelect={onSelect} />
    </QueryClientProvider>,
  )
  return { queryClient, onSelect }
}

describe('AgentModelField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providerSummary.mockResolvedValue({ data: [] })
  })

  it('disables model controls until the catalog loads without selecting a model', async () => {
    let resolve!: (value: { data: ProviderWithModelsResponse[] }) => void
    modelList.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const { onSelect } = renderField()

    expect(screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'common.modelProvider.modelSettings' }),
    ).toBeDisabled()
    expect(screen.queryByText('common.loading')).not.toBeInTheDocument()

    await act(async () => {
      resolve({ data: [] })
    })

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' }),
      ).toBeEnabled()
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps a saved model neutral until both catalog and provider metadata arrive', async () => {
    let resolveCatalog!: (value: { data: ProviderWithModelsResponse[] }) => void
    let resolveProviders!: (value: { data: [] }) => void
    modelList.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCatalog = resolve
        }),
    )
    providerSummary.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProviders = resolve
        }),
    )
    const { onSelect } = renderField({ provider: 'openai', model: 'gpt-4' })
    const trigger = screen.getByRole('button', { name: 'gpt-4' })
    const settings = screen.getByRole('button', { name: 'common.modelProvider.modelSettings' })

    expect(trigger).toBeDisabled()
    expect(settings).toBeDisabled()
    expect(screen.queryByText('common.loading')).not.toBeInTheDocument()
    expect(screen.queryByText(/incompatible|disabled/i)).not.toBeInTheDocument()

    await act(async () => {
      resolveCatalog({ data: [] })
    })
    expect(trigger).toBeDisabled()
    expect(settings).toBeDisabled()
    expect(screen.queryByText(/incompatible|disabled/i)).not.toBeInTheDocument()

    await act(async () => {
      resolveProviders({ data: [] })
    })
    await waitFor(() => {
      expect(trigger).toBeEnabled()
    })
    expect(screen.getByText('common.modelProvider.selector.incompatible')).toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps a failed initial load disabled and lets the user retry', async () => {
    const user = userEvent.setup()
    modelList.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue({ data: [] })
    renderField()

    expect(await screen.findByRole('alert')).toHaveTextContent('common.api.actionFailed')
    expect(screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' }),
      ).toBeEnabled()
    })
  })

  it('keeps the selector available during a background catalog refresh', async () => {
    modelList.mockResolvedValue({ data: [] })
    const { queryClient } = renderField()
    const trigger = screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' })
    await waitFor(() => {
      expect(trigger).toBeEnabled()
    })

    modelList.mockImplementation(() => new Promise(() => {}))
    act(() => {
      void queryClient.invalidateQueries({ queryKey: ['model-list'] })
    })
    await waitFor(() => {
      expect(modelList).toHaveBeenCalledTimes(2)
    })
    expect(trigger).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
