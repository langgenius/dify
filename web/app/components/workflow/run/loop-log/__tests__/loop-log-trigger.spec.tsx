import type { LoopDurationMap, LoopVariableMap } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNodeTracing as createTrace } from '../../../__tests__/fixtures'
import { BlockEnum } from '../../../types'
import LoopLogTrigger from '../loop-log-trigger'

const createNodeTracing = (overrides: Parameters<typeof createTrace>[0] = {}) =>
  createTrace({
    node_id: 'loop-node',
    node_type: BlockEnum.Loop,
    title: 'Loop',
    status: 'succeeded',
    execution_metadata: { total_tokens: 0, total_price: 0, currency: 'USD' },
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
      const onShowLoopResultList =
        vi.fn<NonNullable<React.ComponentProps<typeof LoopLogTrigger>['onShowLoopResultList']>>()
      const onParentClick = vi.fn()
      const detailList = [
        [createNodeTracing({ id: 'loop-1-step-1', status: 'succeeded' })],
        [createNodeTracing({ id: 'loop-2-step-1', status: 'failed' })],
      ]
      const loopDurationMap: LoopDurationMap = { 0: 1.2, 1: 2.5 }
      const loopVariableMap: LoopVariableMap = { 1: { item: 'alpha' } }

      render(
        <div onClick={onParentClick}>
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

      expect(screen.getByText(/workflowLogic\.nodes\.loop\.loop/))!.toBeInTheDocument()
      expect(screen.getByText(/workflowLogic\.nodes\.loop\.error/))!.toBeInTheDocument()

      await user.click(screen.getByRole('button'))

      expect(onParentClick).not.toHaveBeenCalled()
      expect(onShowLoopResultList).toHaveBeenCalledWith(
        detailList,
        loopDurationMap,
        loopVariableMap,
      )
    })
  })
})
