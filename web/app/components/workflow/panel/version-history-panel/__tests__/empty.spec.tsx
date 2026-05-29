import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Empty from '../empty'

describe('VersionHistory Empty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Empty state should show the reset action and forward user clicks.
  describe('User Interactions', () => {
    it('should call onResetFilter when the reset button is clicked', async () => {
      const user = userEvent.setup()
      const onResetFilter = vi.fn()

      render(<Empty onResetFilter={onResetFilter} />)

      expect(screen.getByText('workflow.versionHistory.filter.empty')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'workflow.versionHistory.filter.reset' }))

      expect(onResetFilter).toHaveBeenCalledTimes(1)
    })
  })
})
