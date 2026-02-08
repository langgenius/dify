import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import ApiServer from './ApiServer'

// Mock the secret-key-modal since it involves complex API interactions
vi.mock('@/app/components/develop/secret-key/secret-key-modal', () => ({
  default: ({ isShow, onClose }: { isShow: boolean, onClose: () => void }) => (
    isShow ? <div data-testid="secret-key-modal"><button onClick={onClose}>Close Modal</button></div> : null
  ),
}))

describe('ApiServer', () => {
  const defaultProps = {
    apiBaseUrl: 'https://api.example.com',
  }

  describe('rendering', () => {
    it('should render the API server label', () => {
      render(<ApiServer {...defaultProps} />)
      expect(screen.getByText('appApi.apiServer')).toBeInTheDocument()
    })

    it('should render the API base URL', () => {
      render(<ApiServer {...defaultProps} />)
      expect(screen.getByText('https://api.example.com')).toBeInTheDocument()
    })

    it('should render the OK status badge', () => {
      render(<ApiServer {...defaultProps} />)
      expect(screen.getByText('appApi.ok')).toBeInTheDocument()
    })

    it('should render the API key button', () => {
      render(<ApiServer {...defaultProps} />)
      expect(screen.getByText('appApi.apiKey')).toBeInTheDocument()
    })

    it('should render CopyFeedback component', () => {
      render(<ApiServer {...defaultProps} />)
      // CopyFeedback renders a button for copying
      const copyButtons = screen.getAllByRole('button')
      expect(copyButtons.length).toBeGreaterThan(0)
    })
  })

  describe('with different API URLs', () => {
    it('should render localhost URL', () => {
      render(<ApiServer apiBaseUrl="http://localhost:3000/api" />)
      expect(screen.getByText('http://localhost:3000/api')).toBeInTheDocument()
    })

    it('should render production URL', () => {
      render(<ApiServer apiBaseUrl="https://api.dify.ai/v1" />)
      expect(screen.getByText('https://api.dify.ai/v1')).toBeInTheDocument()
    })

    it('should render URL with path', () => {
      render(<ApiServer apiBaseUrl="https://api.example.com/v1/chat" />)
      expect(screen.getByText('https://api.example.com/v1/chat')).toBeInTheDocument()
    })
  })

  describe('with appId prop', () => {
    it('should render without appId', () => {
      render(<ApiServer apiBaseUrl="https://api.example.com" />)
      expect(screen.getByText('https://api.example.com')).toBeInTheDocument()
    })

    it('should render with appId', () => {
      render(<ApiServer apiBaseUrl="https://api.example.com" appId="app-123" />)
      expect(screen.getByText('https://api.example.com')).toBeInTheDocument()
    })
  })

  describe('SecretKeyButton interaction', () => {
    it('should open modal when API key button is clicked', async () => {
      const user = userEvent.setup()
      render(<ApiServer {...defaultProps} appId="app-123" />)

      const apiKeyButton = screen.getByText('appApi.apiKey')
      await act(async () => {
        await user.click(apiKeyButton)
      })

      expect(screen.getByTestId('secret-key-modal')).toBeInTheDocument()
    })

    it('should close modal when close button is clicked', async () => {
      const user = userEvent.setup()
      render(<ApiServer {...defaultProps} appId="app-123" />)

      // Open modal
      const apiKeyButton = screen.getByText('appApi.apiKey')
      await act(async () => {
        await user.click(apiKeyButton)
      })

      expect(screen.getByTestId('secret-key-modal')).toBeInTheDocument()

      // Close modal
      const closeButton = screen.getByText('Close Modal')
      await act(async () => {
        await user.click(closeButton)
      })

      expect(screen.queryByTestId('secret-key-modal')).not.toBeInTheDocument()
    })
  })

  describe('styling', () => {
    it('should have flex layout with wrap', () => {
      const { container } = render(<ApiServer {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('flex')
      expect(wrapper.className).toContain('flex-wrap')
    })

    it('should have items-center alignment', () => {
      const { container } = render(<ApiServer {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('items-center')
    })

    it('should have gap-y-2 for vertical spacing', () => {
      const { container } = render(<ApiServer {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('gap-y-2')
    })

    it('should apply green styling to OK badge', () => {
      render(<ApiServer {...defaultProps} />)
      const okBadge = screen.getByText('appApi.ok')
      expect(okBadge.className).toContain('bg-[#ECFDF3]')
      expect(okBadge.className).toContain('text-[#039855]')
    })

    it('should have border styling on URL container', () => {
      render(<ApiServer {...defaultProps} />)
      const urlText = screen.getByText('https://api.example.com')
      const urlContainer = urlText.closest('div[class*="rounded-lg"]')
      expect(urlContainer).toBeInTheDocument()
    })
  })

  describe('API server label', () => {
    it('should have correct styling for label', () => {
      render(<ApiServer {...defaultProps} />)
      const label = screen.getByText('appApi.apiServer')
      expect(label.className).toContain('rounded-md')
      expect(label.className).toContain('border')
    })

    it('should have tertiary text color on label', () => {
      render(<ApiServer {...defaultProps} />)
      const label = screen.getByText('appApi.apiServer')
      expect(label.className).toContain('text-text-tertiary')
    })
  })

  describe('URL display', () => {
    it('should have truncate class for long URLs', () => {
      render(<ApiServer {...defaultProps} />)
      const urlText = screen.getByText('https://api.example.com')
      expect(urlText.className).toContain('truncate')
    })

    it('should have font-medium class on URL', () => {
      render(<ApiServer {...defaultProps} />)
      const urlText = screen.getByText('https://api.example.com')
      expect(urlText.className).toContain('font-medium')
    })

    it('should have secondary text color on URL', () => {
      render(<ApiServer {...defaultProps} />)
      const urlText = screen.getByText('https://api.example.com')
      expect(urlText.className).toContain('text-text-secondary')
    })
  })

  describe('divider', () => {
    it('should render vertical divider between URL and copy button', () => {
      const { container } = render(<ApiServer {...defaultProps} />)
      const divider = container.querySelector('.bg-divider-regular')
      expect(divider).toBeInTheDocument()
    })

    it('should have correct divider dimensions', () => {
      const { container } = render(<ApiServer {...defaultProps} />)
      const divider = container.querySelector('.bg-divider-regular')
      expect(divider?.className).toContain('h-[14px]')
      expect(divider?.className).toContain('w-[1px]')
    })
  })

  describe('SecretKeyButton styling', () => {
    it('should have shrink-0 class to prevent shrinking', () => {
      render(<ApiServer {...defaultProps} appId="app-123" />)
      // The SecretKeyButton wraps a Button component
      const button = screen.getByRole('button', { name: /apiKey/i })
      // Check parent container has shrink-0
      const buttonContainer = button.closest('.shrink-0')
      expect(buttonContainer).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('should have accessible button for API key', () => {
      render(<ApiServer {...defaultProps} />)
      const button = screen.getByRole('button', { name: /apiKey/i })
      expect(button).toBeInTheDocument()
    })

    it('should have multiple buttons (copy + API key)', () => {
      render(<ApiServer {...defaultProps} />)
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThanOrEqual(2)
    })
  })
})
