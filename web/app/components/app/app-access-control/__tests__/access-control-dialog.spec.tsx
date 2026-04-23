import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    const onClose = vi.fn()
    render(
      <AccessControlDialog show onClose={onClose}>
        <div>Dialog Content</div>
      </AccessControlDialog>,
    )

    const closeButton = document.body.querySelector('div.absolute.right-5.top-5') as HTMLElement
    fireEvent.click(closeButton)

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
