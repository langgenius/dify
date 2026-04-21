import { fireEvent, render, screen } from '@testing-library/react'
import { getHoveredParallelId } from '../get-hovered-parallel-id'
import TracingPanel from '../tracing-panel'

const mockUseTranslation = vi.hoisted(() => vi.fn())
const mockFormatNodeList = vi.hoisted(() => vi.fn())
const mockUseLogs = vi.hoisted(() => vi.fn())
const mockNodePanel = vi.hoisted(() => vi.fn())
const mockSpecialResultPanel = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

vi.mock('@/app/components/workflow/run/utils/format-log', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockFormatNodeList(...args),
}))

vi.mock('../hooks', () => ({
  useLogs: () => mockUseLogs(),
}))

vi.mock('../node', () => ({
  __esModule: true,
  default: (props: {
    nodeInfo: { id: string }
  }) => {
    mockNodePanel(props)
    return <div data-testid={`node-${props.nodeInfo.id}`}>{props.nodeInfo.id}</div>
  },
}))

vi.mock('../special-result-panel', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockSpecialResultPanel(props)
    return <div data-testid="special-result-panel">special</div>
  },
}))

describe('TracingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTranslation.mockReturnValue({
      t: (key: string) => key,
    })
    mockUseLogs.mockReturnValue({
      showSpecialResultPanel: false,
      showRetryDetail: false,
      setShowRetryDetailFalse: vi.fn(),
      retryResultList: [],
      handleShowRetryResultList: vi.fn(),
      showIteratingDetail: false,
      setShowIteratingDetailFalse: vi.fn(),
      iterationResultList: [],
      iterationResultDurationMap: {},
      handleShowIterationResultList: vi.fn(),
      showLoopingDetail: false,
      setShowLoopingDetailFalse: vi.fn(),
      loopResultList: [],
      loopResultDurationMap: {},
      loopResultVariableMap: {},
      handleShowLoopResultList: vi.fn(),
      agentOrToolLogItemStack: [],
      agentOrToolLogListMap: {},
      handleShowAgentOrToolLog: vi.fn(),
    })
  })

  it('should render formatted nodes, preserve branch labels, and collapse parallel groups', () => {
    mockFormatNodeList.mockReturnValue([
      {
        id: 'parallel-1',
        parallelDetail: {
          isParallelStartNode: true,
          parallelTitle: 'Parallel Group',
          children: [{
            id: 'child-1',
            title: 'Child Node',
            parallelDetail: {
              branchTitle: 'Branch A',
            },
          }],
        },
      },
      {
        id: 'node-2',
        title: 'Standalone Node',
        parallelDetail: {
          branchTitle: 'Branch B',
        },
      },
    ])

    const parentClick = vi.fn()
    const { container } = render(
      <div onClick={parentClick}>
        <TracingPanel
          list={[{ id: 'raw-node' } as never]}
          className="custom-class"
          hideNodeInfo
          hideNodeProcessDetail
        />
      </div>,
    )

    expect(screen.getByText('Parallel Group'))!.toBeInTheDocument()
    expect(screen.getByText('Branch A'))!.toBeInTheDocument()
    expect(screen.getByText('Branch B'))!.toBeInTheDocument()
    expect(screen.getByTestId('node-child-1'))!.toBeInTheDocument()
    expect(screen.getByTestId('node-node-2'))!.toBeInTheDocument()

    fireEvent.click(container.querySelector('.py-2') as HTMLElement)
    expect(parentClick).not.toHaveBeenCalled()

    const hoverTarget = screen.getByText('Parallel Group').closest('[data-parallel-id="parallel-1"]') as HTMLElement
    const nestedParallelTarget = document.createElement('div')
    nestedParallelTarget.setAttribute('data-parallel-id', 'parallel-1')
    const unrelatedTarget = document.createElement('div')
    document.body.appendChild(nestedParallelTarget)
    document.body.appendChild(unrelatedTarget)

    fireEvent.mouseEnter(hoverTarget)
    const sameParallelOut = new MouseEvent('mouseout', { bubbles: true })
    Object.defineProperty(sameParallelOut, 'relatedTarget', { value: nestedParallelTarget })
    hoverTarget.dispatchEvent(sameParallelOut)

    const differentTargetOut = new MouseEvent('mouseout', { bubbles: true })
    Object.defineProperty(differentTargetOut, 'relatedTarget', { value: unrelatedTarget })
    hoverTarget.dispatchEvent(differentTargetOut)

    fireEvent.mouseLeave(hoverTarget)

    fireEvent.click(screen.getAllByRole('button')[0]!)
    expect(container.querySelector('[data-parallel-id="parallel-1"] > div:last-child'))!.toHaveClass('hidden')
    fireEvent.click(screen.getAllByRole('button')[0]!)
    expect(container.querySelector('[data-parallel-id="parallel-1"] > div:last-child')).not.toHaveClass('hidden')
    expect(mockNodePanel).toHaveBeenCalledWith(expect.objectContaining({
      hideInfo: true,
      hideProcessDetail: true,
    }))

    nestedParallelTarget.remove()
    unrelatedTarget.remove()
  })

  it('should switch to the special result panel when the log state requests it', () => {
    mockUseLogs.mockReturnValue({
      showSpecialResultPanel: true,
      showRetryDetail: true,
      setShowRetryDetailFalse: vi.fn(),
      retryResultList: [{ id: 'retry-1' }],
      handleShowRetryResultList: vi.fn(),
      showIteratingDetail: true,
      setShowIteratingDetailFalse: vi.fn(),
      iterationResultList: [[{ id: 'iter-1' }]],
      iterationResultDurationMap: { 0: 1 },
      handleShowIterationResultList: vi.fn(),
      showLoopingDetail: true,
      setShowLoopingDetailFalse: vi.fn(),
      loopResultList: [[{ id: 'loop-1' }]],
      loopResultDurationMap: { 0: 2 },
      loopResultVariableMap: { 0: {} },
      handleShowLoopResultList: vi.fn(),
      agentOrToolLogItemStack: [{ id: 'agent-1' }],
      agentOrToolLogListMap: { agent: [] },
      handleShowAgentOrToolLog: vi.fn(),
    })

    render(<TracingPanel list={[]} />)

    expect(screen.getByTestId('special-result-panel'))!.toBeInTheDocument()
    expect(mockSpecialResultPanel).toHaveBeenCalledWith(expect.objectContaining({
      showRetryDetail: true,
      retryResultList: [{ id: 'retry-1' }],
      showIteratingDetail: true,
      showLoopingDetail: true,
      agentOrToolLogItemStack: [{ id: 'agent-1' }],
    }))
  })

  it('should resolve hovered parallel ids from related targets', () => {
    const sameParallelTarget = document.createElement('div')
    sameParallelTarget.setAttribute('data-parallel-id', 'parallel-1')
    document.body.appendChild(sameParallelTarget)

    const nestedChild = document.createElement('span')
    sameParallelTarget.appendChild(nestedChild)

    const unrelatedTarget = document.createElement('div')

    expect(getHoveredParallelId(nestedChild)).toBe('parallel-1')
    expect(getHoveredParallelId(unrelatedTarget)).toBeNull()
    expect(getHoveredParallelId(null)).toBeNull()

    sameParallelTarget.remove()
  })
})
