import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderEditor as render } from '@/app/components/workflow/editor-resource/__tests__/render'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import { createHttpError } from '@/service/http-error'
import LastRun from '../index'

const mockUseLastRun = vi.hoisted(() => vi.fn())
const mockResultPanel = vi.hoisted(() => vi.fn())

vi.mock('@remixicon/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@remixicon/react')>()),
  RiLoader2Line: () => <div data-testid="loading-icon" />,
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

describe('LastRun', () => {
  const updateNodeRunningStatus = vi.fn()
  const onSingleRunClicked = vi.fn()
  let visibilityState = 'visible'
  const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')
  beforeEach(() => {
    vi.clearAllMocks()
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

  afterEach(() => {
    if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility)
    else Reflect.deleteProperty(document, 'visibilityState')
  })

  it('should show a loader while fetching the last run before any single run starts', () => {
    mockUseLastRun.mockReturnValue({
      data: undefined,
      isFetching: true,
      error: undefined,
    })

    render(
      <LastRun
        nodeId="node-1"
        canSingleRun
        isRunAfterSingleRun={false}
        updateNodeRunningStatus={updateNodeRunningStatus}
        onSingleRunClicked={onSingleRunClicked}
      />,
      { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } },
    )

    expect(screen.getByTestId('loading-icon')).toBeInTheDocument()
    expect(screen.queryByTestId('result-panel')).not.toBeInTheDocument()
  })

  it('should show a running result panel while a single run is still executing', () => {
    render(
      <LastRun
        nodeId="node-1"
        canSingleRun
        isRunAfterSingleRun
        updateNodeRunningStatus={updateNodeRunningStatus}
        onSingleRunClicked={onSingleRunClicked}
        runningStatus={NodeRunningStatus.Running}
      />,
      { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } },
    )

    expect(screen.getByTestId('result-panel')).toHaveTextContent('running')
    expect(mockResultPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'running',
        showSteps: false,
      }),
    )
  })

  it('should render the no-data state for 404 last-run responses and forward single-run clicks', async () => {
    mockUseLastRun.mockReturnValue({
      data: undefined,
      isFetching: false,
      error: createHttpError(new Response(null, { status: 404 })),
    })

    render(
      <LastRun
        nodeId="node-1"
        canSingleRun
        isRunAfterSingleRun={false}
        updateNodeRunningStatus={updateNodeRunningStatus}
        onSingleRunClicked={onSingleRunClicked}
      />,
      { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } },
    )

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'workflowDebug.debug.noData.runThisNode' }))

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
        nodeId="node-1"
        canSingleRun
        isRunAfterSingleRun
        updateNodeRunningStatus={updateNodeRunningStatus}
        onSingleRunClicked={onSingleRunClicked}
        runningStatus={NodeRunningStatus.Succeeded}
        isPaused
      />,
      { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } },
    )

    expect(screen.getByTestId('result-panel')).toHaveTextContent(NodeRunningStatus.Stopped)
    expect(mockResultPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        status: NodeRunningStatus.Stopped,
        total_tokens: 9,
        created_by: 'Alice',
        showSteps: false,
      }),
    )
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
        nodeId="node-1"
        canSingleRun
        isRunAfterSingleRun
        updateNodeRunningStatus={updateNodeRunningStatus}
        onSingleRunClicked={onSingleRunClicked}
        runningStatus={NodeRunningStatus.Stopped}
      />,
      { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } },
    )

    expect(screen.getByTestId('result-panel')).toHaveTextContent(NodeRunningStatus.Stopped)

    rerender(
      <LastRun
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
        nodeId="node-1"
        canSingleRun
        isRunAfterSingleRun
        updateNodeRunningStatus={updateNodeRunningStatus}
        onSingleRunClicked={onSingleRunClicked}
        runningStatus={NodeRunningStatus.Succeeded}
      />,
      { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } },
    )

    act(() => {
      visibilityState = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
      visibilityState = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(screen.getByTestId('result-panel')).toHaveTextContent(NodeRunningStatus.Succeeded)
  })

  it('should restore a completed last run when refreshing the canvas loses its transient status', () => {
    mockUseLastRun.mockReturnValue({
      data: {
        status: NodeRunningStatus.Succeeded,
      },
      isFetching: false,
      error: undefined,
    })

    const props = {
      nodeId: 'node-1',
      canSingleRun: true,
      isRunAfterSingleRun: true,
      updateNodeRunningStatus,
      onSingleRunClicked,
    }
    const { rerender } = render(<LastRun {...props} runningStatus={NodeRunningStatus.Running} />, {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })
    rerender(<LastRun {...props} runningStatus={NodeRunningStatus.Succeeded} />)

    act(() => {
      visibilityState = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
    })
    rerender(<LastRun {...props} runningStatus={NodeRunningStatus.NotStart} />)
    expect(screen.getByTestId('result-panel')).toHaveTextContent(NodeRunningStatus.Succeeded)

    act(() => {
      visibilityState = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(screen.getByTestId('result-panel')).toHaveTextContent(NodeRunningStatus.Succeeded)
    expect(updateNodeRunningStatus).toHaveBeenCalledWith(NodeRunningStatus.Succeeded)
  })
})
