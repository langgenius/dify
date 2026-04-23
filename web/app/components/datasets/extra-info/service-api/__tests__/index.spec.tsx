import { Popover } from '@langgenius/dify-ui/popover'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Card from '../card'
import ServiceApi from '../index'

// Mock Setup

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}))

// Mock next/link
vi.mock('@/next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode, href: string, [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

// Mock API access URL hook
vi.mock('@/hooks/use-api-access-url', () => ({
  useDatasetApiAccessUrl: vi.fn(() => 'https://docs.dify.ai/api-reference/datasets'),
}))

// Mock SecretKeyModal to avoid complex modal rendering
vi.mock('@/app/components/develop/secret-key/secret-key-modal', () => ({
  default: ({ isShow, onClose }: { isShow: boolean, onClose: () => void }) => (
    isShow
      ? (
          <div data-testid="secret-key-modal">
            <button onClick={onClose} data-testid="close-modal-btn">Close</button>
          </div>
        )
      : null
  ),
}))

const renderCard = (ui: React.ReactElement) =>
  render(<Popover open>{ui}</Popover>)

describe('ServiceApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<ServiceApi apiBaseUrl="https://api.example.com" />)
      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })

    it('should render service API title', () => {
      render(<ServiceApi apiBaseUrl="https://api.example.com" />)
      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })

    it('should render Indicator component', () => {
      const { container } = render(<ServiceApi apiBaseUrl="https://api.example.com" />)
      const triggerContainer = container.querySelector('.relative.flex.h-8')
      expect(triggerContainer).toBeInTheDocument()
    })

    it('should render trigger button with proper styling', () => {
      const { container } = render(<ServiceApi apiBaseUrl="https://api.example.com" />)
      const trigger = container.querySelector('.cursor-pointer')
      expect(trigger).toBeInTheDocument()
    })

    it('should render with border and background styles', () => {
      const { container } = render(<ServiceApi apiBaseUrl="https://api.example.com" />)
      const trigger = container.querySelector('[class*="border-components-button-secondary-border-hover"]')
      expect(trigger).toBeInTheDocument()
    })
  })

  describe('Props Variations', () => {
    it('should show Indicator when apiBaseUrl is provided', () => {
      const { container } = render(<ServiceApi apiBaseUrl="https://api.example.com" />)
      const triggerContainer = container.querySelector('.relative.flex.h-8')
      expect(triggerContainer).toBeInTheDocument()
    })

    it('should show Indicator when apiBaseUrl is empty', () => {
      const { container } = render(<ServiceApi apiBaseUrl="" />)
      const triggerContainer = container.querySelector('.relative.flex.h-8')
      expect(triggerContainer).toBeInTheDocument()
    })

    it('should handle long apiBaseUrl without breaking layout', () => {
      const longUrl = 'https://api.example.com/v1/very/long/path/to/endpoint/that/might/break/layout'
      render(<ServiceApi apiBaseUrl={longUrl} />)
      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })

    it('should handle special characters in apiBaseUrl', () => {
      const specialUrl = 'https://api.example.com?query=test&param=value#anchor'
      render(<ServiceApi apiBaseUrl={specialUrl} />)
      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should open popup on trigger click', async () => {
      const user = userEvent.setup()

      render(<ServiceApi apiBaseUrl="https://api.example.com" />)

      const trigger = screen.getByText(/serviceApi\.title/i).closest('[class*="cursor-pointer"]')
      if (trigger)
        await user.click(trigger)

      await waitFor(() => {
        expect(screen.getByText(/serviceApi\.card\.title/i)).toBeInTheDocument()
      })
    })
  })

  describe('Portal and Card Integration', () => {
    it('should pass apiBaseUrl prop to Card component', async () => {
      const user = userEvent.setup()
      const testUrl = 'https://test-api.example.com'

      render(<ServiceApi apiBaseUrl={testUrl} />)

      const trigger = screen.getByText(/serviceApi\.title/i).closest('[class*="cursor-pointer"]')
      if (trigger)
        await user.click(trigger)

      await waitFor(() => {
        expect(screen.getByText(testUrl)).toBeInTheDocument()
      })
    })
  })

  describe('Edge Cases', () => {
    it('should render correctly with empty apiBaseUrl', () => {
      render(<ServiceApi apiBaseUrl="" />)
      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })

    it('should maintain state across prop changes', () => {
      const { rerender } = render(<ServiceApi apiBaseUrl="https://api.example.com" />)

      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()

      rerender(<ServiceApi apiBaseUrl="https://new-api.example.com" />)

      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })
  })
})

describe('Card (service-api)', () => {
  const onOpenSecretKeyModal = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      renderCard(<Card apiBaseUrl="https://api.example.com" onOpenSecretKeyModal={onOpenSecretKeyModal} />)
      expect(screen.getByText(/serviceApi\.card\.title/i)).toBeInTheDocument()
    })

    it('should display apiBaseUrl in endpoint field', () => {
      const testUrl = 'https://api.example.com'
      renderCard(<Card apiBaseUrl={testUrl} onOpenSecretKeyModal={onOpenSecretKeyModal} />)
      expect(screen.getByText(testUrl)).toBeInTheDocument()
    })

    it('should render API Key button', () => {
      renderCard(<Card apiBaseUrl="https://api.example.com" onOpenSecretKeyModal={onOpenSecretKeyModal} />)
      expect(screen.getByText(/serviceApi\.card\.apiKey/i)).toBeInTheDocument()
    })

    it('should render API Reference button', () => {
      renderCard(<Card apiBaseUrl="https://api.example.com" onOpenSecretKeyModal={onOpenSecretKeyModal} />)
      expect(screen.getByText(/serviceApi\.card\.apiReference/i)).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onOpenSecretKeyModal when API Key button is clicked', async () => {
      const user = userEvent.setup()

      renderCard(<Card apiBaseUrl="https://api.example.com" onOpenSecretKeyModal={onOpenSecretKeyModal} />)

      const apiKeyButton = screen.getByText(/serviceApi\.card\.apiKey/i).closest('button')
      if (apiKeyButton)
        await user.click(apiKeyButton)

      expect(onOpenSecretKeyModal).toHaveBeenCalledTimes(1)
    })

    it('should have correct href for API Reference link', () => {
      renderCard(<Card apiBaseUrl="https://api.example.com" onOpenSecretKeyModal={onOpenSecretKeyModal} />)

      const apiRefLink = screen.getByText(/serviceApi\.card\.apiReference/i).closest('a')
      expect(apiRefLink).toHaveAttribute('href', 'https://docs.dify.ai/api-reference/datasets')
    })
  })
})

describe('ServiceApi Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should close popover and open modal when API Key button is clicked', async () => {
    const user = userEvent.setup()

    render(<ServiceApi apiBaseUrl="https://api.example.com" />)

    // Open popover
    const trigger = screen.getByText(/serviceApi\.title/i).closest('[class*="cursor-pointer"]')
    if (trigger)
      await user.click(trigger)

    await waitFor(() => {
      expect(screen.getByText(/serviceApi\.card\.apiKey/i)).toBeInTheDocument()
    })

    // Click API Key button (wrapped by PopoverClose)
    const apiKeyButton = screen.getByText(/serviceApi\.card\.apiKey/i).closest('button')
    if (apiKeyButton)
      await user.click(apiKeyButton)

    // Modal should appear
    await waitFor(() => {
      expect(screen.getByTestId('secret-key-modal')).toBeInTheDocument()
    })

    // Popover should be closed — Card title no longer in document
    await waitFor(() => {
      expect(screen.queryByText(/serviceApi\.card\.title/i)).not.toBeInTheDocument()
    })
  })
})
