import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderEditor as render } from '@/app/components/workflow/editor-resource/__tests__/render'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import { createHttpError } from '@/service/http-error'
import LastRun from '../index'

const mockUseHooksStore = vi.hoisted(() => vi.fn())
const mockUseLastRun = vi.hoisted(() => vi.fn())
const mockResultPanel = vi.hoisted(() => vi.fn())

vi.mock('@remixicon/react', () => ({
  RiLoader2Line: () => <div data-testid="loading-icon" />,
}))

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: (
    selector: (state: { configsMap?: { resourceKind?: string; flowId?: string } }) => unknown,
  ) => mockUseHooksStore(selector),
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

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseHooksStore.mockImplementation(
      (selector: (state: { configsMap?: { resourceKind?: string; flowId?: string } }) => unknown) =>
        selector({
          configsMap: {
            resourceKind: 'appFlow',
            flowId: 'flow-1',
          },
        }),
    )
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
    const user = userEvent.setup()
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

    await user.click(screen.getByRole('button', { name: 'workflowDebug.debug.noData.runThisNode' }))

    expect(onSingleRunClicked).toHaveBeenCalledTimes(1)
  })

  it('keeps a blocked no-data action keyboard accessible for its explanation and restores running after configuration', async () => {
    const user = userEvent.setup()
    mockUseLastRun.mockReturnValue({
      data: undefined,
      isFetching: false,
      error: createHttpError(new Response(null, { status: 404 })),
    })
    const props = {
      nodeId: 'node-1',
      canSingleRun: true,
      isRunAfterSingleRun: false,
      updateNodeRunningStatus,
      onSingleRunClicked,
    }
    const { rerender } = render(
      <LastRun {...props} singleRunDisabledReason="workflow.panel.configureTestRunConnection" />,
    )
    const action = screen.getByRole('button', { name: 'workflowDebug.debug.noData.runThisNode' })
    expect(action).toHaveAttribute('aria-disabled', 'true')
    await user.tab()
    expect(action).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(
      await screen.findByRole('dialog', { name: 'workflowDebug.debug.noData.runThisNode' }),
    ).toBeVisible()
    expect(screen.getByText('workflow.panel.configureTestRunConnection')).toBeVisible()
    expect(onSingleRunClicked).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    rerender(<LastRun {...props} />)
    const configuredAction = screen.getByRole('button', {
      name: 'workflowDebug.debug.noData.runThisNode',
    })
    expect(configuredAction).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(configuredAction)
    expect(onSingleRunClicked).toHaveBeenCalledOnce()
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
