import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNodeTracing } from '../../../__tests__/fixtures'
import RetryLogTrigger from '../retry-log-trigger'

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

      await user.click(
        screen.getByRole('button', { name: 'workflow.nodes.common.retry.retries:{"num":2}' }),
      )

      expect(onShowRetryResultList).toHaveBeenCalledWith(retryDetail)
      expect(parentClick).not.toHaveBeenCalled()
    })
  })
})
