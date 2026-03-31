import type { TracingStatus } from '@/models/app'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Panel from '../panel'
import { TracingProvider } from '../type'

const mockFetchTracingStatus = vi.fn()
const mockFetchTracingConfig = vi.fn()
const mockUpdateTracingStatus = vi.fn()
const mockToast = vi.fn()

const panelState = vi.hoisted(() => ({
  pathname: '/app/test-app/overview',
  isCurrentWorkspaceEditor: true,
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div>loading</div>,
}))

vi.mock('@/app/components/base/divider', () => ({
  default: () => <div data-testid="divider" />,
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}))

vi.mock('@/app/components/header/indicator', () => ({
  default: ({ color }: { color: string }) => <div>{`indicator:${color}`}</div>,
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({ isCurrentWorkspaceEditor: panelState.isCurrentWorkspaceEditor }),
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => panelState.pathname,
}))

vi.mock('@/service/apps', () => ({
  fetchTracingStatus: (...args: unknown[]) => mockFetchTracingStatus(...args),
  fetchTracingConfig: (...args: unknown[]) => mockFetchTracingConfig(...args),
  updateTracingStatus: (...args: unknown[]) => mockUpdateTracingStatus(...args),
}))

vi.mock('../tracing-icon', () => ({
  default: ({ size }: { size: string }) => <div>{`tracing-icon:${size}`}</div>,
}))

vi.mock('../config-button', () => ({
  default: ({
    hasConfigured,
    enabled,
    chosenProvider,
    readOnly,
    onStatusChange,
    onChooseProvider,
    onConfigUpdated,
    onConfigRemoved,
    children,
  }: {
    hasConfigured: boolean
    enabled: boolean
    chosenProvider: TracingProvider | null
    readOnly: boolean
    onStatusChange: (enabled: boolean) => void
    onChooseProvider: (provider: TracingProvider) => void
    onConfigUpdated: (provider: TracingProvider) => void
    onConfigRemoved: (provider: TracingProvider) => void
    children: React.ReactNode
  }) => (
    <div>
      <div>{`config-button:${hasConfigured ? 'configured' : 'primary'}:${readOnly ? 'readonly' : 'editable'}`}</div>
      <div>{children}</div>
      <button type="button" onClick={() => onStatusChange(!enabled)}>{`toggle:${hasConfigured ? 'configured' : 'primary'}`}</button>
      <button type="button" onClick={() => onChooseProvider(TracingProvider.langfuse)}>{`choose:${hasConfigured ? 'configured' : 'primary'}`}</button>
      {[TracingProvider.arize, TracingProvider.phoenix, TracingProvider.langSmith, TracingProvider.langfuse, TracingProvider.opik, TracingProvider.weave, TracingProvider.aliyun, TracingProvider.tencent].map(provider => (
        <button key={`update-${provider}`} type="button" onClick={() => onConfigUpdated(provider)}>{`updated:${hasConfigured ? 'configured' : 'primary'}:${provider}`}</button>
      ))}
      {[TracingProvider.arize, TracingProvider.phoenix, TracingProvider.langSmith, TracingProvider.langfuse, TracingProvider.opik, TracingProvider.weave, TracingProvider.aliyun, TracingProvider.mlflow, TracingProvider.databricks, TracingProvider.tencent].map(provider => (
        <button key={`remove-${provider}`} type="button" onClick={() => onConfigRemoved(chosenProvider ?? provider)}>{`removed:${hasConfigured ? 'configured' : 'primary'}:${provider}`}</button>
      ))}
    </div>
  ),
}))

const createTracingStatus = (overrides: Partial<TracingStatus> = {}): TracingStatus => ({
  tracing_provider: null,
  enabled: false,
  ...overrides,
})

const createFetchConfigResponse = (provider: TracingProvider) => {
  if (provider === TracingProvider.langfuse) {
    return {
      tracing_config: { secret_key: 'secret', public_key: 'public', host: 'https://langfuse.example' },
      has_not_configured: false,
    }
  }

  return {
    tracing_config: null,
    has_not_configured: true,
  }
}

describe('OverviewRouteTracingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    panelState.pathname = '/app/test-app/overview'
    panelState.isCurrentWorkspaceEditor = true
    mockUpdateTracingStatus.mockResolvedValue(undefined)
    mockFetchTracingStatus.mockResolvedValue(createTracingStatus())
    mockFetchTracingConfig.mockImplementation(({ provider }: { provider: TracingProvider }) => Promise.resolve(createFetchConfigResponse(provider)))
  })

  it('should show the loading state while tracing status is still pending', () => {
    mockFetchTracingStatus.mockReturnValue(new Promise(() => {}))

    render(<Panel />)

    expect(screen.getByText('loading')).toBeInTheDocument()
  })

  it('should load tracing data and handle status, choose, and refresh actions', async () => {
    render(<Panel />)

    await waitFor(() => expect(screen.getByText('config-button:primary:editable')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('config-button:configured:editable')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'toggle:configured' }))
    fireEvent.click(screen.getByRole('button', { name: 'choose:primary' }))
    fireEvent.click(screen.getByRole('button', { name: 'updated:configured:langfuse' }))

    await waitFor(() => {
      expect(mockUpdateTracingStatus).toHaveBeenCalledWith({
        appId: 'test-app',
        body: {
          tracing_provider: null,
          enabled: true,
        },
      })
    })

    expect(mockUpdateTracingStatus).toHaveBeenCalledWith({
      appId: 'test-app',
      body: {
        tracing_provider: TracingProvider.langfuse,
        enabled: true,
      },
    })
    expect(mockFetchTracingConfig).toHaveBeenCalledWith({
      appId: 'test-app',
      provider: TracingProvider.langfuse,
    })
    expect(mockToast).toHaveBeenCalledWith('common.api.success', { type: 'success' })
  })

  it('should disable the current tracing provider without a toast when that provider is removed', async () => {
    mockFetchTracingStatus.mockResolvedValue(createTracingStatus({
      enabled: true,
      tracing_provider: TracingProvider.langfuse,
    }))

    render(<Panel />)

    await waitFor(() => expect(screen.getByText('config-button:configured:editable')).toBeInTheDocument())
    expect(screen.queryByText('config-button:primary:editable')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'removed:configured:langfuse' }))

    await waitFor(() => {
      expect(mockUpdateTracingStatus).toHaveBeenCalledWith({
        appId: 'test-app',
        body: {
          enabled: false,
          tracing_provider: null,
        },
      })
    })
  })

  it('should pass read-only state through to config buttons for viewers', async () => {
    panelState.isCurrentWorkspaceEditor = false

    render(<Panel />)

    await waitFor(() => expect(screen.getByText('config-button:primary:readonly')).toBeInTheDocument())
  })

  it('should hydrate and update every provider branch when all tracing configs are available', async () => {
    mockFetchTracingConfig.mockImplementation(({ provider }: { provider: TracingProvider }) => Promise.resolve({
      tracing_config: { provider },
      has_not_configured: false,
    }))

    render(<Panel />)

    await waitFor(() => expect(screen.getByText('config-button:configured:editable')).toBeInTheDocument())

    const updateProviders = [
      TracingProvider.arize,
      TracingProvider.phoenix,
      TracingProvider.langSmith,
      TracingProvider.langfuse,
      TracingProvider.opik,
      TracingProvider.weave,
      TracingProvider.aliyun,
      TracingProvider.tencent,
    ]

    updateProviders.forEach((provider) => {
      fireEvent.click(screen.getByRole('button', { name: `updated:configured:${provider}` }))
    })

    const removeProviders = [
      TracingProvider.arize,
      TracingProvider.phoenix,
      TracingProvider.langSmith,
      TracingProvider.opik,
      TracingProvider.weave,
      TracingProvider.aliyun,
      TracingProvider.mlflow,
      TracingProvider.databricks,
      TracingProvider.tencent,
    ]

    removeProviders.forEach((provider) => {
      fireEvent.click(screen.getByRole('button', { name: `removed:configured:${provider}` }))
    })

    await waitFor(() => {
      expect(mockFetchTracingConfig).toHaveBeenCalledWith({
        appId: 'test-app',
        provider: TracingProvider.arize,
      })
    })
  })
})
