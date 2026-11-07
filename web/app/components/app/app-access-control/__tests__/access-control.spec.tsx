import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import AccessControlDialog from '../access-control-dialog'

describe('AccessControlDialog', () => {
  it('should trigger onClose when clicking the close control', async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()
    render(
      <AccessControlDialog show onClose={handleClose}>
        <div>Dialog Content</div>
      </AccessControlDialog>,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(handleClose).toHaveBeenCalledTimes(1)
  })
})
