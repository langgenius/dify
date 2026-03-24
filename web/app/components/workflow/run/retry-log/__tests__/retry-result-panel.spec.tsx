/* eslint-disable ts/no-explicit-any */
import type { NodeTracing } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '../../../types'
import RetryResultPanel from '../retry-result-panel'

vi.mock('../../tracing-panel', () => ({
  default: ({ list }: any) => (
    <div>
      {list.map((item: any) => (
        <div key={item.id}>{item.title}</div>
      ))}
    </div>
  ),
}))

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
  status: 'succeeded',
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
  ...overrides,
})

describe('RetryResultPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The retry result panel should expose a back action and relabel each retry attempt in the tracing list.
  describe('Rendering', () => {
    it('should render retry titles and call onBack from the back header', async () => {
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

      expect(onBack).toHaveBeenCalled()
    })
  })
})
