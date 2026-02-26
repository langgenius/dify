import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ViewFormDropdown from './view-form-dropdown'

// Mock InputsFormContent to avoid complex integration in this test
vi.mock('./content', () => ({
  default: () => <div data-testid="mock-inputs-form-content" />,
}))

// Note: PortalToFollowElem is mocked globally in vitest.setup.ts
// to render children in the normal DOM flow when open is true.

describe('ViewFormDropdown', () => {
  const user = userEvent.setup()

  it('should render the trigger button', () => {
    render(<ViewFormDropdown />)
    expect(screen.getByTestId('view-form-dropdown-trigger')).toBeInTheDocument()
  })

  it('should not show content initially', () => {
    render(<ViewFormDropdown />)
    expect(screen.queryByTestId('view-form-dropdown-content')).not.toBeInTheDocument()
  })

  it('should show content when trigger is clicked', async () => {
    render(<ViewFormDropdown />)
    await user.click(screen.getByTestId('view-form-dropdown-trigger'))

    expect(screen.getByTestId('view-form-dropdown-content')).toBeInTheDocument()
    expect(screen.getByText(/chat.chatSettingsTitle/i)).toBeInTheDocument()
    expect(screen.getByTestId('mock-inputs-form-content')).toBeInTheDocument()
  })

  it('should close content when trigger is clicked again', async () => {
    render(<ViewFormDropdown />)
    const trigger = screen.getByTestId('view-form-dropdown-trigger')

    await user.click(trigger) // Open
    expect(screen.getByTestId('view-form-dropdown-content')).toBeInTheDocument()

    await user.click(trigger) // Close
    expect(screen.queryByTestId('view-form-dropdown-content')).not.toBeInTheDocument()
  })

  it('should apply iconColor class to the icon', async () => {
    render(<ViewFormDropdown iconColor="text-red-500" />)
    await user.click(screen.getByTestId('view-form-dropdown-trigger'))

    const icon = screen.getByTestId('view-form-dropdown-trigger').querySelector('.i-ri-chat-settings-line')
    expect(icon).toHaveClass('text-red-500')
  })
})
