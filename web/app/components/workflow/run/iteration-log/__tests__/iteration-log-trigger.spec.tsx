import type { IterationDurationMap, NodeTracing } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNodeTracing as createTrace } from '../../../__tests__/fixtures'
import { BlockEnum, NodeRunningStatus } from '../../../types'
import IterationLogTrigger from '../iteration-log-trigger'

const createNodeTracing = (overrides: Partial<NodeTracing> = {}) =>
  createTrace({
    node_id: 'iteration-node',
    node_type: BlockEnum.Iteration,
    title: 'Iteration',
    ...overrides,
  })

const createExecutionMetadata = (
  overrides: Partial<NonNullable<NodeTracing['execution_metadata']>> = {},
) => ({
  total_tokens: 0,
  total_price: 0,
  currency: 'USD',
  ...overrides,
})

describe('IterationLogTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Structured Detail Handling', () => {
    it('should reconstruct structured iteration groups from execution metadata and include failed missing details', async () => {
      const user = userEvent.setup()
      const onShowIterationResultList = vi.fn()
      const iterationDurationMap: IterationDurationMap = { 'parallel-1': 1.1, '1': 2.2 }
      const missingFailedIteration = [
        createNodeTracing({
          id: 'failed-step',
          status: NodeRunningStatus.Failed,
          execution_metadata: createExecutionMetadata({
            iteration_index: 2,
          }),
        }),
      ]
      const allExecutions = [
        createNodeTracing({
          id: 'parallel-step',
          execution_metadata: createExecutionMetadata({
            parallel_mode_run_id: 'parallel-1',
          }),
        }),
        createNodeTracing({
          id: 'serial-step',
          execution_metadata: createExecutionMetadata({
            iteration_id: 'iteration-node',
            iteration_index: 1,
          }),
        }),
      ]

      render(
        <IterationLogTrigger
          nodeInfo={createNodeTracing({
            details: [missingFailedIteration],
            execution_metadata: createExecutionMetadata({
              iteration_duration_map: iterationDurationMap,
            }),
          })}
          allExecutions={allExecutions}
          onShowIterationResultList={onShowIterationResultList}
        />,
      )

      await user.click(screen.getByRole('button'))

      expect(onShowIterationResultList).toHaveBeenCalledWith(
        [[allExecutions[0]], [allExecutions[1]], missingFailedIteration],
        iterationDurationMap,
      )
    })

    it('should fall back to details and metadata length when duration map is unavailable', async () => {
      const user = userEvent.setup()
      const onShowIterationResultList = vi.fn()
      const detailList = [[createNodeTracing({ id: 'detail-1' })]]

      render(
        <IterationLogTrigger
          nodeInfo={createNodeTracing({
            details: detailList,
            metadata: {
              iterator_length: 3,
              iterator_index: 0,
              loop_length: 0,
              loop_index: 0,
            },
          })}
          onShowIterationResultList={onShowIterationResultList}
        />,
      )

      expect(
        screen.getByRole('button', { name: /workflowLogic\.nodes\.iteration\.iteration/ }),
      ).toBeInTheDocument()

      await user.click(screen.getByRole('button'))

      expect(onShowIterationResultList).toHaveBeenCalledWith(detailList, {})
    })

    it('should return an empty structured list when duration map exists without executions', async () => {
      const user = userEvent.setup()
      const onShowIterationResultList = vi.fn()
      const iterationDurationMap: IterationDurationMap = { orphaned: 1.5 }

      render(
        <IterationLogTrigger
          nodeInfo={createNodeTracing({
            execution_metadata: createExecutionMetadata({
              iteration_duration_map: iterationDurationMap,
            }),
          })}
          onShowIterationResultList={onShowIterationResultList}
        />,
      )

      await user.click(screen.getByRole('button'))

      expect(onShowIterationResultList).toHaveBeenCalledWith([], iterationDurationMap)
    })

    it('should count failed iterations from allExecutions and ignore unmatched duration map keys', async () => {
      const user = userEvent.setup()
      const onShowIterationResultList = vi.fn()
      const iterationDurationMap: IterationDurationMap = { orphaned: 0.6, 1: 1.1 }
      const allExecutions = [
        createNodeTracing({
          id: 'failed-serial-step',
          status: NodeRunningStatus.Failed,
          execution_metadata: createExecutionMetadata({
            iteration_id: 'iteration-node',
            iteration_index: 1,
          }),
        }),
      ]

      render(
        <IterationLogTrigger
          nodeInfo={createNodeTracing({
            details: [[createNodeTracing({ id: 'detail-success' })]],
            execution_metadata: createExecutionMetadata({
              iteration_duration_map: iterationDurationMap,
            }),
          })}
          allExecutions={allExecutions}
          onShowIterationResultList={onShowIterationResultList}
        />,
      )

      expect(
        screen.getByRole('button', { name: /workflowLogic\.nodes\.iteration\.error/i }),
      ).toBeInTheDocument()

      await user.click(screen.getByRole('button'))

      expect(onShowIterationResultList).toHaveBeenCalledWith(
        [[allExecutions[0]]],
        iterationDurationMap,
      )
    })
  })
})
