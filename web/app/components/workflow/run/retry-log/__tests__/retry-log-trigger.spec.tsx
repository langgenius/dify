import type { NodeTracing } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '../../../types'
import RetryLogTrigger from '../retry-log-trigger'

const createNodeTracing = (overrides: Partial<NodeTracing> = {}): NodeTracing => ({
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
  elapsed_time: 0.2,
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
  outputs_full_content: undefined,
  execution_metadata: undefined,
  extras: undefined,
  retryDetail: [],
  ...overrides,
})

describe('RetryLogTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Clicking the trigger should stop bubbling and expose the retry detail list.
  describe('User Interactions', () => {
    it('should forward retry details and stop parent clicks', async () => {
      const user = userEvent.setup()
      const onShowRetryResultList = vi.fn()
      const parentClick = vi.fn()
      const retryDetail = [
        createNodeTracing({ id: 'retry-1' }),
        createNodeTracing({ id: 'retry-2' }),
      ]

      render(
        <div onClick={parentClick}>
          <RetryLogTrigger
            nodeInfo={createNodeTracing({ retryDetail })}
            onShowRetryResultList={onShowRetryResultList}
          />
        </div>,
      )

      await user.click(screen.getByRole('button', { name: 'workflow.nodes.common.retry.retries:{"num":2}' }))

      expect(onShowRetryResultList).toHaveBeenCalledWith(retryDetail)
      expect(parentClick).not.toHaveBeenCalled()
    })

    it('should fall back to an empty retry list when details are missing', async () => {
      const user = userEvent.setup()
      const onShowRetryResultList = vi.fn()

      render(
        <RetryLogTrigger
          nodeInfo={createNodeTracing({ retryDetail: undefined })}
          onShowRetryResultList={onShowRetryResultList}
        />,
      )

      await user.click(screen.getByRole('button'))

      expect(onShowRetryResultList).toHaveBeenCalledWith([])
    })
  })
})
