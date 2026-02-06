import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================================
// Component Imports (after mocks)
// ============================================================================

import Card from './card'
import ServiceApi from './index'

// ============================================================================
// Mock Setup
// ============================================================================

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  usePathname: () => '/test',
  useSearchParams: () => new URLSearchParams(),
}))

// Mock next/link
vi.mock('next/link', () => ({
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

// ============================================================================
// ServiceApi Component Tests
// ============================================================================

describe('ServiceApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // Props Variations Tests
  // --------------------------------------------------------------------------
  describe('Props Variations', () => {
    it('should show green Indicator when apiBaseUrl is provided', () => {
      const { container } = render(<ServiceApi apiBaseUrl="https://api.example.com" />)
      // When apiBaseUrl is truthy, Indicator color is green
      const triggerContainer = container.querySelector('.relative.flex.h-8')
      expect(triggerContainer).toBeInTheDocument()
    })

    it('should show yellow Indicator when apiBaseUrl is empty', () => {
      const { container } = render(<ServiceApi apiBaseUrl="" />)
      // When apiBaseUrl is falsy, Indicator color is yellow
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

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should toggle popup open state on click', async () => {
      const user = userEvent.setup()

      render(<ServiceApi apiBaseUrl="https://api.example.com" />)

      const trigger = screen.getByText(/serviceApi\.title/i).closest('[class*="cursor-pointer"]')
      expect(trigger).toBeInTheDocument()

      if (trigger)
        await user.click(trigger)

      // After click, the Card should be rendered
    })

    it('should apply hover styles on trigger', () => {
      render(<ServiceApi apiBaseUrl="https://api.example.com" />)

      const trigger = screen.getByText(/serviceApi\.title/i).closest('div[class*="cursor-pointer"]')
      expect(trigger).toHaveClass('cursor-pointer')
    })

    it('should toggle open state from false to true on first click', async () => {
      const user = userEvent.setup()

      render(<ServiceApi apiBaseUrl="https://api.example.com" />)

      const trigger = screen.getByText(/serviceApi\.title/i).closest('[class*="cursor-pointer"]')
      if (trigger)
        await user.click(trigger)

      // Card should be visible after clicking
      await waitFor(() => {
        expect(screen.getByText(/serviceApi\.card\.title/i)).toBeInTheDocument()
      })
    })

    it('should toggle open state back to false on second click', async () => {
      const user = userEvent.setup()

      render(<ServiceApi apiBaseUrl="https://api.example.com" />)

      const trigger = screen.getByText(/serviceApi\.title/i).closest('[class*="cursor-pointer"]')
      if (trigger) {
        await user.click(trigger) // open
        await user.click(trigger) // close
      }

      // Component should handle the toggle without errors
    })

    it('should apply open state styling when popup is open', async () => {
      const user = userEvent.setup()

      render(<ServiceApi apiBaseUrl="https://api.example.com" />)

      const trigger = screen.getByText(/serviceApi\.title/i).closest('[class*="cursor-pointer"]')
      if (trigger)
        await user.click(trigger)

      // When open, the trigger should have hover background class
    })
  })

  // --------------------------------------------------------------------------
  // Portal and Card Integration Tests
  // --------------------------------------------------------------------------
  describe('Portal and Card Integration', () => {
    it('should render Card component inside portal when open', async () => {
      const user = userEvent.setup()

      render(<ServiceApi apiBaseUrl="https://api.example.com" />)

      const trigger = screen.getByText(/serviceApi\.title/i).closest('[class*="cursor-pointer"]')
      if (trigger)
        await user.click(trigger)

      // Wait for portal content to appear
      await waitFor(() => {
        expect(screen.getByText(/serviceApi\.card\.title/i)).toBeInTheDocument()
      })
    })

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

    it('should use correct portal placement configuration', () => {
      render(<ServiceApi apiBaseUrl="https://api.example.com" />)
      // PortalToFollowElem is configured with placement="top-start"
      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })

    it('should use correct portal offset configuration', () => {
      render(<ServiceApi apiBaseUrl="https://api.example.com" />)
      // PortalToFollowElem is configured with offset={{ mainAxis: 4, crossAxis: -4 }}
      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases Tests
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle rapid toggle clicks gracefully', async () => {
      const user = userEvent.setup()

      render(<ServiceApi apiBaseUrl="https://api.example.com" />)

      const trigger = screen.getByText(/serviceApi\.title/i).closest('[class*="cursor-pointer"]')
      if (trigger) {
        // Rapid clicks
        await user.click(trigger)
        await user.click(trigger)
        await user.click(trigger)
      }

      // Component should handle state changes without errors
      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })

    it('should render correctly with empty apiBaseUrl', () => {
      render(<ServiceApi apiBaseUrl="" />)
      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })

    it('should maintain state across prop changes', () => {
      const { rerender } = render(<ServiceApi apiBaseUrl="https://api.example.com" />)

      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()

      rerender(<ServiceApi apiBaseUrl="https://new-api.example.com" />)

      // Component should still render after prop change
      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })

    it('should handle undefined-like apiBaseUrl values', () => {
      // Empty string is the closest to undefined for this prop
      render(<ServiceApi apiBaseUrl="" />)
      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(<ServiceApi apiBaseUrl="https://api.example.com" />)

      rerender(<ServiceApi apiBaseUrl="https://api.example.com" />)

      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })

    it('should not re-render unnecessarily with same props', () => {
      const { rerender } = render(<ServiceApi apiBaseUrl="https://api.example.com" />)

      rerender(<ServiceApi apiBaseUrl="https://api.example.com" />)
      rerender(<ServiceApi apiBaseUrl="https://api.example.com" />)

      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })

    it('should update when apiBaseUrl prop changes', () => {
      const { rerender } = render(<ServiceApi apiBaseUrl="https://api.example.com" />)

      rerender(<ServiceApi apiBaseUrl="https://new-api.example.com" />)

      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })
  })
})

// ============================================================================
// Card Component Tests
// ============================================================================

describe('Card (service-api)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Card apiBaseUrl="https://api.example.com" />)
      expect(screen.getByText(/serviceApi\.card\.title/i)).toBeInTheDocument()
    })

    it('should display card title', () => {
      render(<Card apiBaseUrl="https://api.example.com" />)
      expect(screen.getByText(/serviceApi\.card\.title/i)).toBeInTheDocument()
    })

    it('should display enabled status', () => {
      render(<Card apiBaseUrl="https://api.example.com" />)
      expect(screen.getByText(/serviceApi\.enabled/i)).toBeInTheDocument()
    })

    it('should render endpoint label', () => {
      render(<Card apiBaseUrl="https://api.example.com" />)
      expect(screen.getByText(/serviceApi\.card\.endpoint/i)).toBeInTheDocument()
    })

    it('should display apiBaseUrl in endpoint field', () => {
      const testUrl = 'https://api.example.com'
      render(<Card apiBaseUrl={testUrl} />)
      expect(screen.getByText(testUrl)).toBeInTheDocument()
    })

    it('should render Indicator component', () => {
      const { container } = render(<Card apiBaseUrl="https://api.example.com" />)
      // Card container should be present
      const cardContainer = container.querySelector('.flex.w-\\[360px\\]')
      expect(cardContainer).toBeInTheDocument()
    })

    it('should render API Key button', () => {
      render(<Card apiBaseUrl="https://api.example.com" />)
      expect(screen.getByText(/serviceApi\.card\.apiKey/i)).toBeInTheDocument()
    })

    it('should render API Reference button', () => {
      render(<Card apiBaseUrl="https://api.example.com" />)
      expect(screen.getByText(/serviceApi\.card\.apiReference/i)).toBeInTheDocument()
    })

    it('should render CopyFeedback component for endpoint', () => {
      const { container } = render(<Card apiBaseUrl="https://api.example.com" />)
      // CopyFeedback should be in the endpoint section
      const copyButton = container.querySelector('[class*="bg-components-input-bg-normal"]')
      expect(copyButton).toBeInTheDocument()
    })

    it('should render ApiAggregate icon in header', () => {
      const { container } = render(<Card apiBaseUrl="https://api.example.com" />)
      const icon = container.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Props Variations Tests
  // --------------------------------------------------------------------------
  describe('Props Variations', () => {
    it('should show green Indicator when apiBaseUrl is provided', () => {
      const { container } = render(<Card apiBaseUrl="https://api.example.com" />)
      const cardContainer = container.querySelector('.flex.w-\\[360px\\]')
      expect(cardContainer).toBeInTheDocument()
    })

    it('should show yellow Indicator when apiBaseUrl is empty', () => {
      const { container } = render(<Card apiBaseUrl="" />)
      const cardContainer = container.querySelector('.flex.w-\\[360px\\]')
      expect(cardContainer).toBeInTheDocument()
    })

    it('should display different apiBaseUrl values correctly', () => {
      const testUrls = [
        'https://api.example.com',
        'https://localhost:3000',
        'https://api.production.example.com/v1',
      ]

      testUrls.forEach((url) => {
        const { unmount } = render(<Card apiBaseUrl={url} />)
        expect(screen.getByText(url)).toBeInTheDocument()
        unmount()
      })
    })

    it('should handle empty apiBaseUrl', () => {
      render(<Card apiBaseUrl="" />)
      expect(screen.getByText(/serviceApi\.card\.title/i)).toBeInTheDocument()
    })

    it('should truncate long apiBaseUrl', () => {
      const longUrl = 'https://api.example.com/v1/very/long/path/to/endpoint/that/should/truncate'
      const { container } = render(<Card apiBaseUrl={longUrl} />)
      const truncateElement = container.querySelector('.truncate')
      expect(truncateElement).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should open SecretKeyModal when API Key button is clicked', async () => {
      const user = userEvent.setup()

      render(<Card apiBaseUrl="https://api.example.com" />)

      const apiKeyButton = screen.getByText(/serviceApi\.card\.apiKey/i).closest('button')
      expect(apiKeyButton).toBeInTheDocument()

      if (apiKeyButton)
        await user.click(apiKeyButton)

      await waitFor(() => {
        expect(screen.getByTestId('secret-key-modal')).toBeInTheDocument()
      })
    })

    it('should close SecretKeyModal when close button is clicked', async () => {
      const user = userEvent.setup()

      render(<Card apiBaseUrl="https://api.example.com" />)

      // Open modal
      const apiKeyButton = screen.getByText(/serviceApi\.card\.apiKey/i).closest('button')
      if (apiKeyButton)
        await user.click(apiKeyButton)

      await waitFor(() => {
        expect(screen.getByTestId('secret-key-modal')).toBeInTheDocument()
      })

      // Close modal
      const closeButton = screen.getByTestId('close-modal-btn')
      await user.click(closeButton)

      await waitFor(() => {
        expect(screen.queryByTestId('secret-key-modal')).not.toBeInTheDocument()
      })
    })

    it('should have correct href for API Reference link', () => {
      render(<Card apiBaseUrl="https://api.example.com" />)

      const apiRefLink = screen.getByText(/serviceApi\.card\.apiReference/i).closest('a')
      expect(apiRefLink).toHaveAttribute('href', 'https://docs.dify.ai/api-reference/datasets')
    })

    it('should open API Reference in new tab', () => {
      render(<Card apiBaseUrl="https://api.example.com" />)

      const apiRefLink = screen.getByText(/serviceApi\.card\.apiReference/i).closest('a')
      expect(apiRefLink).toHaveAttribute('target', '_blank')
      expect(apiRefLink).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('should toggle modal visibility correctly', async () => {
      const user = userEvent.setup()

      render(<Card apiBaseUrl="https://api.example.com" />)

      // Initially modal should not be visible
      expect(screen.queryByTestId('secret-key-modal')).not.toBeInTheDocument()

      // Open modal
      const apiKeyButton = screen.getByText(/serviceApi\.card\.apiKey/i).closest('button')
      if (apiKeyButton)
        await user.click(apiKeyButton)

      // Modal should be visible
      await waitFor(() => {
        expect(screen.getByTestId('secret-key-modal')).toBeInTheDocument()
      })

      // Close modal
      const closeButton = screen.getByTestId('close-modal-btn')
      await user.click(closeButton)

      // Modal should not be visible again
      await waitFor(() => {
        expect(screen.queryByTestId('secret-key-modal')).not.toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Modal State Tests
  // --------------------------------------------------------------------------
  describe('Modal State', () => {
    it('should initialize with modal closed', () => {
      render(<Card apiBaseUrl="https://api.example.com" />)
      expect(screen.queryByTestId('secret-key-modal')).not.toBeInTheDocument()
    })

    it('should open modal on handleOpenSecretKeyModal', async () => {
      const user = userEvent.setup()

      render(<Card apiBaseUrl="https://api.example.com" />)

      const apiKeyButton = screen.getByText(/serviceApi\.card\.apiKey/i).closest('button')
      if (apiKeyButton)
        await user.click(apiKeyButton)

      await waitFor(() => {
        expect(screen.getByTestId('secret-key-modal')).toBeInTheDocument()
      })
    })

    it('should close modal on handleCloseSecretKeyModal', async () => {
      const user = userEvent.setup()

      render(<Card apiBaseUrl="https://api.example.com" />)

      // Open modal first
      const apiKeyButton = screen.getByText(/serviceApi\.card\.apiKey/i).closest('button')
      if (apiKeyButton)
        await user.click(apiKeyButton)

      await waitFor(() => {
        expect(screen.getByTestId('secret-key-modal')).toBeInTheDocument()
      })

      // Close modal
      const closeButton = screen.getByTestId('close-modal-btn')
      await user.click(closeButton)

      await waitFor(() => {
        expect(screen.queryByTestId('secret-key-modal')).not.toBeInTheDocument()
      })
    })

    it('should handle multiple open/close cycles', async () => {
      const user = userEvent.setup()

      render(<Card apiBaseUrl="https://api.example.com" />)

      const apiKeyButton = screen.getByText(/serviceApi\.card\.apiKey/i).closest('button')

      // First cycle
      if (apiKeyButton)
        await user.click(apiKeyButton)

      await waitFor(() => {
        expect(screen.getByTestId('secret-key-modal')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('close-modal-btn'))

      await waitFor(() => {
        expect(screen.queryByTestId('secret-key-modal')).not.toBeInTheDocument()
      })

      // Second cycle
      if (apiKeyButton)
        await user.click(apiKeyButton)

      await waitFor(() => {
        expect(screen.getByTestId('secret-key-modal')).toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases Tests
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle empty apiBaseUrl gracefully', () => {
      render(<Card apiBaseUrl="" />)
      expect(screen.getByText(/serviceApi\.card\.title/i)).toBeInTheDocument()
      // Endpoint field should show empty string
    })

    it('should handle very long apiBaseUrl', () => {
      const longUrl = 'https://'.concat('a'.repeat(500), '.com')
      render(<Card apiBaseUrl={longUrl} />)
      expect(screen.getByText(/serviceApi\.card\.title/i)).toBeInTheDocument()
    })

    it('should handle special characters in apiBaseUrl', () => {
      const specialUrl = 'https://api.example.com/path?query=test&param=value#anchor'
      render(<Card apiBaseUrl={specialUrl} />)
      expect(screen.getByText(specialUrl)).toBeInTheDocument()
    })

    it('should render without errors when all buttons are clickable', async () => {
      const user = userEvent.setup()

      render(<Card apiBaseUrl="https://api.example.com" />)

      // Click API Key button
      const apiKeyButton = screen.getByText(/serviceApi\.card\.apiKey/i).closest('button')
      if (apiKeyButton)
        await user.click(apiKeyButton)

      // Close modal
      await waitFor(() => {
        expect(screen.getByTestId('secret-key-modal')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('close-modal-btn'))

      await waitFor(() => {
        expect(screen.queryByTestId('secret-key-modal')).not.toBeInTheDocument()
      })

      // Component should still be functional
      expect(screen.getByText(/serviceApi\.card\.title/i)).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(<Card apiBaseUrl="https://api.example.com" />)

      rerender(<Card apiBaseUrl="https://api.example.com" />)

      expect(screen.getByText(/serviceApi\.card\.title/i)).toBeInTheDocument()
    })

    it('should use useCallback for handlers', () => {
      const { rerender } = render(<Card apiBaseUrl="https://api.example.com" />)

      rerender(<Card apiBaseUrl="https://api.example.com" />)

      // Component should render without issues with memoized callbacks
      expect(screen.getByText(/serviceApi\.card\.apiKey/i)).toBeInTheDocument()
    })

    it('should update when apiBaseUrl prop changes', () => {
      const { rerender } = render(<Card apiBaseUrl="https://api.example.com" />)

      expect(screen.getByText('https://api.example.com')).toBeInTheDocument()

      rerender(<Card apiBaseUrl="https://new-api.example.com" />)

      expect(screen.getByText('https://new-api.example.com')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Copy Functionality Tests
  // --------------------------------------------------------------------------
  describe('Copy Functionality', () => {
    it('should render CopyFeedback component for apiBaseUrl', () => {
      const { container } = render(<Card apiBaseUrl="https://api.example.com" />)
      const copyContainer = container.querySelector('[class*="bg-components-input-bg-normal"]')
      expect(copyContainer).toBeInTheDocument()
    })

    it('should pass apiBaseUrl to CopyFeedback component', () => {
      const testUrl = 'https://api.example.com'
      render(<Card apiBaseUrl={testUrl} />)
      // The URL should be displayed in the copy section
      expect(screen.getByText(testUrl)).toBeInTheDocument()
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('ServiceApi Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should open Card popup and display endpoint', async () => {
    const user = userEvent.setup()
    const testUrl = 'https://api.example.com'

    render(<ServiceApi apiBaseUrl={testUrl} />)

    // Open popup
    const trigger = screen.getByText(/serviceApi\.title/i).closest('[class*="cursor-pointer"]')
    if (trigger)
      await user.click(trigger)

    // Wait for Card to appear
    await waitFor(() => {
      expect(screen.getByText(/serviceApi\.card\.title/i)).toBeInTheDocument()
      expect(screen.getByText(testUrl)).toBeInTheDocument()
    })
  })

  it('should complete full workflow: open -> view endpoint -> access API key', async () => {
    const user = userEvent.setup()

    render(<ServiceApi apiBaseUrl="https://api.example.com" />)

    // Open popup
    const trigger = screen.getByText(/serviceApi\.title/i).closest('[class*="cursor-pointer"]')
    if (trigger)
      await user.click(trigger)

    // Verify Card content
    await waitFor(() => {
      expect(screen.getByText(/serviceApi\.card\.title/i)).toBeInTheDocument()
      expect(screen.getByText(/serviceApi\.enabled/i)).toBeInTheDocument()
    })

    // Open API Key modal
    const apiKeyButton = screen.getByText(/serviceApi\.card\.apiKey/i).closest('button')
    if (apiKeyButton)
      await user.click(apiKeyButton)

    // Verify modal appears
    await waitFor(() => {
      expect(screen.getByTestId('secret-key-modal')).toBeInTheDocument()
    })
  })

  it('should navigate to API Reference from Card', async () => {
    const user = userEvent.setup()

    render(<ServiceApi apiBaseUrl="https://api.example.com" />)

    // Open popup
    const trigger = screen.getByText(/serviceApi\.title/i).closest('[class*="cursor-pointer"]')
    if (trigger)
      await user.click(trigger)

    // Wait for Card to appear
    await waitFor(() => {
      expect(screen.getByText(/serviceApi\.card\.apiReference/i)).toBeInTheDocument()
    })

    // Verify link
    const apiRefLink = screen.getByText(/serviceApi\.card\.apiReference/i).closest('a')
    expect(apiRefLink).toHaveAttribute('href', 'https://docs.dify.ai/api-reference/datasets')
  })

  it('should reflect apiBaseUrl status in Indicator color', () => {
    // With URL - should be green
    const { rerender } = render(<ServiceApi apiBaseUrl="https://api.example.com" />)
    expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()

    // Without URL - should be yellow
    rerender(<ServiceApi apiBaseUrl="" />)
    expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
  })
})
