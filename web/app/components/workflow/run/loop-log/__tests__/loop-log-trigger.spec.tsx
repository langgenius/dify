import type { LoopDurationMap, LoopVariableMap, NodeTracing } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '../../../types'
import LoopLogTrigger from '../loop-log-trigger'

const createNodeTracing = (overrides: Partial<NodeTracing> = {}): NodeTracing => ({
  id: 'trace-1',
  index: 0,
  predecessor_node_id: '',
  node_id: 'loop-node',
  node_type: BlockEnum.Loop,
  title: 'Loop',
  inputs: {},
  inputs_truncated: false,
  process_data: {},
  process_data_truncated: false,
  outputs: {},
  outputs_truncated: false,
  status: 'succeeded',
  error: '',
  elapsed_time: 0.2,
  execution_metadata: {
    total_tokens: 0,
    total_price: 0,
    currency: 'USD',
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

describe('LoopLogTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Loop triggers should summarize count/error status and forward structured details.
  describe('Structured Detail Handling', () => {
    it('should pass existing loop details, durations, and variables to the callback', async () => {
      const user = userEvent.setup()
      const onShowLoopResultList = vi.fn()
      const detailList = [
        [createNodeTracing({ id: 'loop-1-step-1', status: 'succeeded' })],
        [createNodeTracing({ id: 'loop-2-step-1', status: 'failed' })],
      ]
      const loopDurationMap: LoopDurationMap = { 0: 1.2, 1: 2.5 }
      const loopVariableMap: LoopVariableMap = { 1: { item: 'alpha' } }

      render(
        <div onClick={vi.fn()}>
          <LoopLogTrigger
            nodeInfo={createNodeTracing({
              details: detailList,
              loopDurationMap,
              execution_metadata: {
                total_tokens: 0,
                total_price: 0,
                currency: 'USD',
                loop_duration_map: loopDurationMap,
                loop_variable_map: loopVariableMap,
              },
            })}
            onShowLoopResultList={onShowLoopResultList}
          />
        </div>,
      )

      expect(screen.getByText(/workflow\.nodes\.loop\.loop/))!.toBeInTheDocument()
      expect(screen.getByText(/workflow\.nodes\.loop\.error/))!.toBeInTheDocument()

      await user.click(screen.getByRole('button'))

      expect(onShowLoopResultList).toHaveBeenCalledWith(detailList, loopDurationMap, loopVariableMap)
    })

    it('should reconstruct loop detail groups from execution metadata when details are absent', async () => {
      const user = userEvent.setup()
      const onShowLoopResultList = vi.fn()
      const loopDurationMap: LoopDurationMap = {
        'parallel-1': 1.5,
        '2': 2.2,
      }
      const allExecutions = [
        createNodeTracing({
          id: 'parallel-child',
          execution_metadata: {
            total_tokens: 0,
            total_price: 0,
            currency: 'USD',
            parallel_mode_run_id: 'parallel-1',
          },
        }),
        createNodeTracing({
          id: 'serial-child',
          execution_metadata: {
            total_tokens: 0,
            total_price: 0,
            currency: 'USD',
            loop_id: 'loop-node',
            loop_index: 2,
          },
        }),
      ]

      render(
        <LoopLogTrigger
          nodeInfo={createNodeTracing({
            details: undefined,
            execution_metadata: {
              total_tokens: 0,
              total_price: 0,
              currency: 'USD',
              loop_duration_map: loopDurationMap,
              loop_variable_map: {},
            },
          })}
          allExecutions={allExecutions}
          onShowLoopResultList={onShowLoopResultList}
        />,
      )

      await user.click(screen.getByRole('button'))

      expect(onShowLoopResultList).toHaveBeenCalledTimes(1)
      const [structuredList, durations, variableMap] = (onShowLoopResultList.mock.calls[0] ?? []) as [any, any, any]
      expect(structuredList).toHaveLength(2)
      expect(structuredList).toEqual(
        expect.arrayContaining([
          [allExecutions[0]],
          [allExecutions[1]],
        ]),
      )
      expect(durations).toEqual(loopDurationMap)
      expect(variableMap).toEqual({})
    })
  })
})
