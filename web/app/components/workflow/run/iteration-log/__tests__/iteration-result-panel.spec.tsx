import type { IterationDurationMap, NodeTracing } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum, NodeRunningStatus } from '../../../types'
import IterationResultPanel from '../iteration-result-panel'

const createTrace = (id: string, overrides: Partial<NodeTracing> = {}): NodeTracing => ({
  id,
  index: 0,
  predecessor_node_id: '',
  node_id: `node-${id}`,
  node_type: BlockEnum.Code,
  title: `Iteration Step ${id}`,
  inputs: {},
  inputs_truncated: false,
  process_data: {},
  process_data_truncated: false,
  outputs: {},
  outputs_truncated: false,
  status: NodeRunningStatus.Succeeded,
  error: '',
  elapsed_time: 0.2,
  execution_metadata: {
    total_tokens: 0,
    total_price: 0,
    currency: 'USD',
    iteration_index: 0,
    parallel_mode_run_id: 'iter-1',
  },
  metadata: {
    iterator_length: 0,
    iterator_index: 0,
    loop_length: 0,
    loop_index: 0,
  },
  created_at: 1710000000,
  created_by: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
  },
  finished_at: 1710000001,
  ...overrides,
})

describe('IterationResultPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows iteration duration, toggles tracing details, and calls onBack', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    const iterDurationMap: IterationDurationMap = { 'iter-1': 1.2 }
    const { container } = render(
      <IterationResultPanel
        list={[[createTrace('1')]]}
        onBack={onBack}
        iterDurationMap={iterDurationMap}
      />,
    )

    expect(screen.getByText('1.20s')).toBeInTheDocument()
    expect(container.querySelectorAll('.transition-all.duration-200.opacity-100')).toHaveLength(0)

    await user.click(screen.getByText((_, node) => node?.textContent === 'workflow.singleRun.iteration 1'))

    const expandArrow = container.querySelector('.transition-transform.duration-200')
    if (!expandArrow)
      throw new Error('Expected iteration expand arrow to be rendered')
    expect(expandArrow).toHaveClass('rotate-90')
    expect(container.querySelectorAll('.transition-all.duration-200.opacity-100')).toHaveLength(1)

    await user.click(screen.getByText('workflow.singleRun.back'))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
