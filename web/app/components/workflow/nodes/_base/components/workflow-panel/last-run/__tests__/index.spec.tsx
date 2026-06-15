import { act, render, screen } from '@testing-library/react'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import LastRun from '../index'

const mockUseHooksStore = vi.hoisted(() => vi.fn())
const mockUseLastRun = vi.hoisted(() => vi.fn())
const mockResultPanel = vi.hoisted(() => vi.fn())

vi.mock('@remixicon/react', () => ({
  RiLoader2Line: () => <div data-testid="loading-icon" />,
}))

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: (selector: (state: {
    configsMap?: { flowType?: string, flowId?: string }
  }) => unknown) => mockUseHooksStore(selector),
}))

vi.mock('@/service/use-workflow', () => ({
  useLastRun: (...args: unknown[]) => mockUseLastRun(...args),
}))

vi.mock('@/app/components/workflow/run/result-panel', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockResultPanel(props)
    return <div data-testid="result-panel">{String(props.status)}</div>
  },
}))

vi.mock('../no-data', () => ({
  __esModule: true,
  default: ({ onSingleRun }: { onSingleRun: () => void }) => (
    <button type="button" onClick={onSingleRun}>
      no-data
    </button>
  ),
}))

describe('LastRun', () => {
  const updateNodeRunningStatus = vi.fn()
  const onSingleRunClicked = vi.fn()
  let visibilityState = 'visible'

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseHooksStore.mockImplementation((selector: (state: {
      configsMap?: { flowType?: string, flowId?: string }
    }) => unknown) => selector({
      configsMap: {
        flowType: 'appFlow',
        flowId: 'flow-1',
      },
    }))
    mockUseLastRun.mockReturnValue({
      data: undefined,
      isFetching: false,
      error: undefined,
    })
    visibilityState = 'visible'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    })
  })

  it('should show a loader while fetching the last run before any single run starts', () => {
    mockUseLastRun.mockReturnValue({
      data: undefined,
      isFetching: true,
      error: undefined,
    })

    render(
      <LastRun
        appId="app-1"
        nodeId="node-1"
        canSingleRun
        isRunAfterSingleRun={false}
        updateNodeRunningStatus={updateNodeRunningStatus}
        onSingleRunClicked={onSingleRunClicked}
      />,
    )

    expect(screen.getByTestId('loading-icon')).toBeInTheDocument()
    expect(screen.queryByTestId('result-panel')).not.toBeInTheDocument()
  })

  it('should show a running result panel while a single run is still executing', () => {
    render(
      <LastRun
        appId="app-1"
        nodeId="node-1"
        canSingleRun
        isRunAfterSingleRun
        updateNodeRunningStatus={updateNodeRunningStatus}
        onSingleRunClicked={onSingleRunClicked}
        runningStatus={NodeRunningStatus.Running}
      />,
    )

    expect(screen.getByTestId('result-panel')).toHaveTextContent('running')
    expect(mockResultPanel).toHaveBeenCalledWith(expect.objectContaining({
      status: 'running',
      showSteps: false,
    }))
  })

  it('should render the no-data state for 404 last-run responses and forward single-run clicks', () => {
    mockUseLastRun.mockReturnValue({
      data: undefined,
      isFetching: false,
      error: { status: 404 },
    })

    render(
      <LastRun
        appId="app-1"
        nodeId="node-1"
        canSingleRun
        isRunAfterSingleRun={false}
        updateNodeRunningStatus={updateNodeRunningStatus}
        onSingleRunClicked={onSingleRunClicked}
      />,
    )

    act(() => {
      screen.getByText('no-data').click()
    })

    expect(onSingleRunClicked).toHaveBeenCalledTimes(1)
  })

  it('should render resolved result data and let paused state override the final status', () => {
    mockUseLastRun.mockReturnValue({
      data: {
        status: NodeRunningStatus.Succeeded,
        execution_metadata: { total_tokens: 9 },
        created_by_account: { created_by: 'Alice' },
      },
      isFetching: false,
      error: undefined,
    })

    render(
      <LastRun
        appId="app-1"
        nodeId="node-1"
        canSingleRun
        isRunAfterSingleRun
        updateNodeRunningStatus={updateNodeRunningStatus}
        onSingleRunClicked={onSingleRunClicked}
        runningStatus={NodeRunningStatus.Succeeded}
        isPaused
      />,
    )

    expect(screen.getByTestId('result-panel')).toHaveTextContent(NodeRunningStatus.Stopped)
    expect(mockResultPanel).toHaveBeenCalledWith(expect.objectContaining({
      status: NodeRunningStatus.Stopped,
      total_tokens: 9,
      created_by: 'Alice',
      showSteps: false,
    }))
  })

  it('should respect stopped and listening one-step statuses', () => {
    mockUseLastRun.mockReturnValue({
      data: {
        status: NodeRunningStatus.Succeeded,
      },
      isFetching: false,
      error: undefined,
    })

    const { rerender } = render(
      <LastRun
        appId="app-1"
        nodeId="node-1"
        canSingleRun
        isRunAfterSingleRun
        updateNodeRunningStatus={updateNodeRunningStatus}
        onSingleRunClicked={onSingleRunClicked}
        runningStatus={NodeRunningStatus.Stopped}
      />,
    )

    expect(screen.getByTestId('result-panel')).toHaveTextContent(NodeRunningStatus.Stopped)

    rerender(
      <LastRun
        appId="app-1"
        nodeId="node-1"
        canSingleRun
        isRunAfterSingleRun
        updateNodeRunningStatus={updateNodeRunningStatus}
        onSingleRunClicked={onSingleRunClicked}
        runningStatus={NodeRunningStatus.Listening}
      />,
    )

    expect(screen.getByTestId('result-panel')).toHaveTextContent(NodeRunningStatus.Listening)
  })

  it('should react to page visibility changes while keeping the current result rendered', () => {
    mockUseLastRun.mockReturnValue({
      data: {
        status: NodeRunningStatus.Succeeded,
      },
      isFetching: false,
      error: undefined,
    })

    render(
      <LastRun
        appId="app-1"
        nodeId="node-1"
        canSingleRun
        isRunAfterSingleRun
        updateNodeRunningStatus={updateNodeRunningStatus}
        onSingleRunClicked={onSingleRunClicked}
        runningStatus={NodeRunningStatus.Succeeded}
      />,
    )

    act(() => {
      visibilityState = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
      visibilityState = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(screen.getByTestId('result-panel')).toHaveTextContent(NodeRunningStatus.Succeeded)
  })
})
