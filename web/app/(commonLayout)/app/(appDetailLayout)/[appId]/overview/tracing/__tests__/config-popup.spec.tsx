import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConfigButton from '../config-button'
import ConfigPopup from '../config-popup'
import { TracingProvider } from '../type'

const testState = vi.hoisted(() => ({
  fetchTraceConfigs: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      byAppId: {
        traceConfigs: {
          get: {
            key: () => ['trace-configs'],
            queryOptions: ({ input }: { input: unknown }) => ({
              queryKey: ['trace-configs', input],
              queryFn: () => testState.fetchTraceConfigs(input),
            }),
          },
        },
      },
    },
  },
}))

vi.mock('../provider-panel', () => ({
  default: ({
    type,
    readOnly,
    hasConfigured,
  }: {
    type: string
    readOnly: boolean
    hasConfigured: boolean
  }) => (
    <div
      data-testid={`provider-${type}`}
      data-read-only={String(readOnly)}
      data-has-configured={String(hasConfigured)}
    >
      {type}
    </div>
  ),
}))

vi.mock('../tracing-icon', () => ({
  default: () => <span>Tracing</span>,
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('ConfigPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    testState.fetchTraceConfigs.mockResolvedValue({
      enabled: false,
      tracing_provider: null,
      configured_providers: [],
      configs: [],
    })
  })

  it('loads all provider configurations only after the popup opens', async () => {
    const user = userEvent.setup()
    render(
      <ConfigButton
        appId="app-1"
        readOnly={false}
        hasConfigured={false}
        enabled={false}
        onStatusChange={vi.fn()}
        chosenProvider={null}
        onChooseProvider={vi.fn()}
        onConfigRemoved={vi.fn()}
      >
        <button type="button">Open tracing</button>
      </ConfigButton>,
      { wrapper: createWrapper() },
    )

    expect(testState.fetchTraceConfigs).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Open tracing' }))

    await waitFor(() => {
      expect(testState.fetchTraceConfigs).toHaveBeenCalledTimes(1)
    })
    expect(testState.fetchTraceConfigs).toHaveBeenCalledWith({
      params: { app_id: 'app-1' },
      query: { include_config: true },
    })
  })

  it('shows a retry action when loading configurations fails', async () => {
    const user = userEvent.setup()
    testState.fetchTraceConfigs.mockRejectedValueOnce(new Error('network error'))

    render(
      <ConfigPopup
        appId="app-1"
        readOnly={false}
        enabled={false}
        onStatusChange={vi.fn()}
        chosenProvider={null}
        onChooseProvider={vi.fn()}
        onConfigRemoved={vi.fn()}
      />,
      { wrapper: createWrapper() },
    )

    const retry = await screen.findByRole('button', { name: 'common.operation.retry' })
    expect(screen.getByRole('alert')).toBeInTheDocument()

    testState.fetchTraceConfigs.mockResolvedValue({
      enabled: false,
      tracing_provider: null,
      configured_providers: [],
      configs: [],
    })
    await user.click(retry)

    await waitFor(() => {
      expect(testState.fetchTraceConfigs).toHaveBeenCalledTimes(2)
    })
    expect(await screen.findByText('langfuse')).toBeInTheDocument()
  })

  it('keeps healthy providers usable when another configuration cannot be loaded', async () => {
    testState.fetchTraceConfigs.mockResolvedValue({
      enabled: true,
      tracing_provider: 'langfuse',
      configured_providers: ['langfuse', 'mlflow'],
      configs: [
        {
          id: 'config-1',
          tracing_provider: 'langfuse',
          tracing_config: {
            public_key: 'pk',
            secret_key: '********',
            host: 'https://cloud.langfuse.com',
          },
        },
        {
          id: 'config-2',
          tracing_provider: 'mlflow',
          error: 'config_unavailable',
        },
      ],
    })

    render(
      <ConfigPopup
        appId="app-1"
        readOnly={false}
        enabled
        onStatusChange={vi.fn()}
        chosenProvider={TracingProvider.langfuse}
        onChooseProvider={vi.fn()}
        onConfigRemoved={vi.fn()}
      />,
      { wrapper: createWrapper() },
    )

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByTestId('provider-langfuse')).toHaveAttribute('data-read-only', 'false')
    expect(screen.getByTestId('provider-langfuse')).toHaveAttribute('data-has-configured', 'true')
    expect(screen.getByTestId('provider-mlflow')).toHaveAttribute('data-read-only', 'true')
    expect(screen.getByTestId('provider-mlflow')).toHaveAttribute('data-has-configured', 'true')
  })
})
