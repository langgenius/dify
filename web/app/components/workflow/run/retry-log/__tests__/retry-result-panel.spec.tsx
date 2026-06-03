import type { NodeTracing } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum, NodeRunningStatus } from '../../../types'
import RetryResultPanel from '../retry-result-panel'

const createTrace = (overrides: Partial<NodeTracing> = {}): NodeTracing => ({
  id: 'trace-1',
  index: 0,
  predecessor_node_id: '',
  node_id: 'node-1',
  node_type: BlockEnum.Code,
  title: 'Code',
  inputs: {},
  inputs_truncated: false,
  process_data: {},
  process_data_truncated: false,
  outputs: {},
  outputs_truncated: false,
  status: NodeRunningStatus.Succeeded,
  error: '',
  elapsed_time: 0.1,
  metadata: {
    iterator_length: 0,
    iterator_index: 0,
    loop_length: 0,
    loop_index: 0,
  },
  created_at: 1,
  created_by: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
  },
  finished_at: 2,
  execution_metadata: {
    total_tokens: 0,
    total_price: 0,
    currency: 'USD',
  },
  ...overrides,
})

describe('RetryResultPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders retry titles through the real tracing panel and triggers the back action', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()

    render(
      <RetryResultPanel
        list={[createTrace({ id: 'retry-1' }), createTrace({ id: 'retry-2' })]}
        onBack={onBack}
      />,
    )

    expect(screen.getByText('workflow.nodes.common.retry.retry 1')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.common.retry.retry 2')).toBeInTheDocument()

    await user.click(screen.getByText('workflow.singleRun.back'))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
