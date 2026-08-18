import { fireEvent, screen, waitFor } from '@testing-library/react'
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
    const handleClose = vi.fn()
    render(
      <AccessControlDialog show onClose={handleClose}>
        <div>Dialog Content</div>
      </AccessControlDialog>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => {
      expect(handleClose).toHaveBeenCalledTimes(1)
    })
  })
})
