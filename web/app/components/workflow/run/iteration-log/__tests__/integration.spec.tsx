import type { IterationDurationMap, NodeTracing } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import IterationResultPanel from '../iteration-result-panel'

vi.mock('@/app/components/workflow/run/tracing-panel', () => ({
  default: ({ list }: { list: NodeTracing[] }) => (
    <div data-testid="tracing-panel">
      {list.map(item => (
        <div key={`${item.node_id}-${item.execution_metadata?.iteration_index}`}>{item.node_id}</div>
      ))}
    </div>
  ),
}))

const createTracing = (
  nodeId: string,
  status: NodeRunningStatus,
  iterationIndex: number,
  parallelModeRunId?: string,
): NodeTracing => {
  return {
    node_id: nodeId,
    status,
    execution_metadata: {
      iteration_index: iterationIndex,
      parallel_mode_run_id: parallelModeRunId,
    },
  } as NodeTracing
}

describe('IterationResultPanel integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render failed, running, and completed iterations and toggle tracing details', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    const list: NodeTracing[][] = [
      [createTracing('failed-node', NodeRunningStatus.Failed, 0, 'iter-1')],
      [createTracing('running-node', NodeRunningStatus.Running, 1, 'iter-2')],
      [createTracing('done-node', NodeRunningStatus.Succeeded, 2, 'iter-3')],
    ]
    const durationMap: IterationDurationMap = {
      'iter-3': 0.001,
    }

    const { container } = render(
      <IterationResultPanel
        list={list}
        onBack={onBack}
        iterDurationMap={durationMap}
      />,
    )

    expect(screen.getByText('0.01s')).toBeInTheDocument()

    await user.click(screen.getByText('workflow.singleRun.back'))
    expect(onBack).toHaveBeenCalledTimes(1)

    await user.click(screen.getByText((_, node) => node?.textContent === 'workflow.singleRun.iteration 3'))
    expect(container.querySelectorAll('.opacity-100')).toHaveLength(1)
    expect(screen.getByText('done-node')).toBeInTheDocument()

    await user.click(screen.getByText((_, node) => node?.textContent === 'workflow.singleRun.iteration 3'))
    expect(container.querySelectorAll('.opacity-100')).toHaveLength(0)
  })
})
