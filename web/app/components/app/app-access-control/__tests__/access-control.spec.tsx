import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import AccessControlDialog from '../access-control-dialog'

describe('AccessControlDialog', () => {
  it('should render dialog content when visible', () => {
    render(
      <AccessControlDialog show className="custom-dialog">
        <div>Dialog Content</div>
      </AccessControlDialog>,
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Dialog Content')).toBeInTheDocument()
  })

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
