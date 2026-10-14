import type { ComponentProps, ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { fetchTracingConfig, fetchTracingStatus, updateTracingStatus } from '@/service/apps'
import Panel from '../panel'

const testState = vi.hoisted(() => ({
  configButtonProps: [] as Array<{
    readOnly: boolean
    hasConfigured: boolean
  }>,
}))

vi.mock('@/service/apps', () => ({
  fetchTracingStatus: vi.fn(),
  fetchTracingConfig: vi.fn(),
  updateTracingStatus: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/status-dot', () => ({
  StatusDot: ({ status }: { status: string }) => <span data-testid="status-dot">{status}</span>,
}))

vi.mock('../config-button', () => ({
  default: ({
    children,
    ...props
  }: ComponentProps<'div'> & {
    readOnly: boolean
    hasConfigured: boolean
    children?: ReactNode
  }) => {
    testState.configButtonProps.push({
      readOnly: props.readOnly,
      hasConfigured: props.hasConfigured,
    })

    return (
      <div
        data-testid="config-button"
        data-read-only={String(props.readOnly)}
        data-has-configured={String(props.hasConfigured)}
      >
        {children}
      </div>
    )
  },
}))

const mockedFetchTracingStatus = vi.mocked(fetchTracingStatus)
const mockedFetchTracingConfig = vi.mocked(fetchTracingConfig)
const mockedUpdateTracingStatus = vi.mocked(updateTracingStatus)

const renderPanel = async (readOnly = true) => {
  render(<Panel appId="app-1" readOnly={readOnly} />)
  await screen.findAllByTestId('config-button')
}

describe('Tracing overview panel', () => {
  beforeEach(() => {
    testState.configButtonProps = []
    mockedFetchTracingStatus.mockResolvedValue({
      enabled: false,
      tracing_provider: null,
    })
    mockedFetchTracingConfig.mockResolvedValue({
      tracing_provider: 'langfuse',
      tracing_config: {},
      has_not_configured: true,
    } as Awaited<ReturnType<typeof fetchTracingConfig>>)
    mockedUpdateTracingStatus.mockResolvedValue({
      result: 'success',
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('marks tracing config as read-only when requested by its owner', async () => {
    await renderPanel()

    await waitFor(() => {
      expect(testState.configButtonProps[0]).toMatchObject({
        readOnly: true,
        hasConfigured: false,
      })
    })
  })

  it('allows tracing config when the owner grants write access', async () => {
    await renderPanel(false)

    await waitFor(() => {
      expect(testState.configButtonProps[0]).toMatchObject({
        readOnly: false,
        hasConfigured: false,
      })
    })
  })
})
