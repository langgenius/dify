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

  it('should render every retry attempt with its details', async () => {
    const attempts = [
      createTrace({
        id: 'retry-1',
        status: NodeRunningStatus.Retry,
        inputs: { attempt: 1 },
        process_data: { request: 'attempt-1' },
        outputs: { status_code: 500 },
        error: 'first failure',
        expand: true,
      }),
      createTrace({
        id: 'retry-2',
        status: NodeRunningStatus.Retry,
        inputs: { attempt: 2 },
        process_data: { request: 'attempt-2' },
        outputs: { status_code: 503 },
        error: 'second failure',
        expand: true,
      }),
    ]

    render(<RetryResultPanel list={attempts} onBack={vi.fn()} />)

    expect(screen.getByText('workflow.nodes.common.retry.retry 1')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.common.retry.retry 2')).toBeInTheDocument()
    expect(await screen.findByText('first failure')).toBeInTheDocument()
    expect(screen.getByText('second failure')).toBeInTheDocument()
    expect(screen.getByText(/attempt-1/)).toBeInTheDocument()
    expect(screen.getByText(/attempt-2/)).toBeInTheDocument()
    expect(screen.getByText(/500/)).toBeInTheDocument()
    expect(screen.getByText(/503/)).toBeInTheDocument()
  })

  it('should trigger the back action when back is clicked', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()

    render(<RetryResultPanel list={[]} onBack={onBack} />)

    await user.click(screen.getByText('workflow.singleRun.back'))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
