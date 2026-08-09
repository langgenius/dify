import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ViewFormDropdown from '../view-form-dropdown'

vi.mock('../content', () => ({
  default: () => <div>Form content</div>,
}))

describe('ViewFormDropdown', () => {
  it('toggles the form settings', async () => {
    const user = userEvent.setup()
    render(<ViewFormDropdown />)

    const trigger = screen.getByRole('button', { name: 'share.chat.chatSettingsTitle' })
    expect(screen.queryByText('Form content')).not.toBeInTheDocument()

    await user.click(trigger)
    expect(screen.getByText('Form content')).toBeInTheDocument()

    await user.click(trigger)
    expect(screen.queryByText('Form content')).not.toBeInTheDocument()
  })
})
