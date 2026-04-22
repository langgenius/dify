import type { NodeTracing } from '@/types/workflow'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BlockEnum, NodeRunningStatus } from '../../types'
import NodePanel from '../node'

const createNodeInfo = (overrides: Partial<NodeTracing> = {}): NodeTracing => ({
  id: 'trace-node-1',
  index: 0,
  predecessor_node_id: '',
  node_id: 'node-1',
  node_type: BlockEnum.Code,
  title: 'Code Node',
  inputs: undefined,
  inputs_truncated: false,
  process_data: undefined,
  process_data_truncated: false,
  outputs_truncated: false,
  status: NodeRunningStatus.Succeeded,
  elapsed_time: 1.25,
  execution_metadata: {
    total_tokens: 64,
    total_price: 0,
    currency: 'USD',
  },
  metadata: {
    iterator_length: 0,
    iterator_index: 0,
    loop_length: 0,
    loop_index: 0,
  },
  created_at: 0,
  created_by: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
  },
  finished_at: 1,
  ...overrides,
})

describe('Run NodePanel', () => {
  it('renders the running state in the header without the finished summary', () => {
    render(
      <NodePanel
        nodeInfo={createNodeInfo({
          status: NodeRunningStatus.Running,
        })}
      />,
    )

    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.queryByText('1.250 s')).not.toBeInTheDocument()
  })

  it('shows the stopped reason when the panel is expanded from tracing state', async () => {
    render(
      <NodePanel
        nodeInfo={createNodeInfo({
          expand: true,
          status: NodeRunningStatus.Stopped,
        })}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(/Alice/)).toBeInTheDocument()
    })
  })

  it('forwards iteration details through the real iteration trigger', async () => {
    const handleShowIterationDetail = vi.fn()
    const details = [[createNodeInfo({
      id: 'iter-trace-1',
      node_id: 'iter-node-1',
      execution_metadata: {
        total_tokens: 8,
        total_price: 0,
        currency: 'USD',
        iteration_index: 0,
      },
    })]]
    const iterDurationMap = { 0: 1.2 }

    render(
      <NodePanel
        nodeInfo={createNodeInfo({
          expand: true,
          node_type: BlockEnum.Iteration,
          details,
          iterDurationMap,
        })}
        onShowIterationDetail={handleShowIterationDetail}
      />,
    )

    const trigger = await screen.findByRole('button')
    fireEvent.click(trigger)

    expect(handleShowIterationDetail).toHaveBeenCalledWith(details, iterDurationMap)
  })

  it('forwards retry details through the real retry trigger', async () => {
    const handleShowRetryDetail = vi.fn()
    const retryDetail = [
      createNodeInfo({
        id: 'retry-trace-1',
        node_id: 'retry-node-1',
        retry_index: 1,
        status: NodeRunningStatus.Failed,
      }),
    ]

    render(
      <NodePanel
        nodeInfo={createNodeInfo({
          expand: true,
          retryDetail,
          status: NodeRunningStatus.Failed,
        })}
        onShowRetryDetail={handleShowRetryDetail}
      />,
    )

    const trigger = await screen.findByRole('button')
    fireEvent.click(trigger)

    expect(handleShowRetryDetail).toHaveBeenCalledWith(retryDetail)
  })
})
