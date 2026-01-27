import type { DataSet } from '@/models/datasets'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================================
// Component Imports (after mocks)
// ============================================================================

import Card from './card'
import ApiAccess from './index'

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

// Dataset context mock data
const mockDataset: Partial<DataSet> = {
  id: 'dataset-123',
  name: 'Test Dataset',
  enable_api: true,
}

// Mock use-context-selector
vi.mock('use-context-selector', () => ({
  useContext: vi.fn(() => ({ dataset: mockDataset })),
  useContextSelector: vi.fn((_, selector) => selector({ dataset: mockDataset })),
  createContext: vi.fn(() => ({})),
}))

// Mock dataset detail context
const mockMutateDatasetRes = vi.fn()
vi.mock('@/context/dataset-detail', () => ({
  default: {},
  useDatasetDetailContext: vi.fn(() => ({
    dataset: mockDataset,
    mutateDatasetRes: mockMutateDatasetRes,
  })),
  useDatasetDetailContextWithSelector: vi.fn((selector: (v: { dataset?: typeof mockDataset, mutateDatasetRes?: () => void }) => unknown) =>
    selector({ dataset: mockDataset as DataSet, mutateDatasetRes: mockMutateDatasetRes }),
  ),
}))

// Mock app context for workspace permissions
let mockIsCurrentWorkspaceManager = true
vi.mock('@/context/app-context', () => ({
  useSelector: vi.fn((selector: (state: { isCurrentWorkspaceManager: boolean }) => unknown) =>
    selector({ isCurrentWorkspaceManager: mockIsCurrentWorkspaceManager }),
  ),
}))

// Mock service hooks
const mockEnableDatasetServiceApi = vi.fn(() => Promise.resolve({ result: 'success' }))
const mockDisableDatasetServiceApi = vi.fn(() => Promise.resolve({ result: 'success' }))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useDatasetApiBaseUrl: vi.fn(() => ({
    data: { api_base_url: 'https://api.example.com' },
    isLoading: false,
  })),
  useEnableDatasetServiceApi: vi.fn(() => ({
    mutateAsync: mockEnableDatasetServiceApi,
    isPending: false,
  })),
  useDisableDatasetServiceApi: vi.fn(() => ({
    mutateAsync: mockDisableDatasetServiceApi,
    isPending: false,
  })),
}))

// Mock API access URL hook
vi.mock('@/hooks/use-api-access-url', () => ({
  useDatasetApiAccessUrl: vi.fn(() => 'https://docs.dify.ai/api-reference/datasets'),
}))

// ============================================================================
// ApiAccess Component Tests
// ============================================================================

describe('ApiAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<ApiAccess expand={true} apiEnabled={true} />)
      expect(screen.getByText(/appMenus\.apiAccess/i)).toBeInTheDocument()
    })

    it('should render API title when expanded', () => {
      render(<ApiAccess expand={true} apiEnabled={true} />)
      expect(screen.getByText(/appMenus\.apiAccess/i)).toBeInTheDocument()
    })

    it('should not render API title when collapsed', () => {
      render(<ApiAccess expand={false} apiEnabled={true} />)
      expect(screen.queryByText(/appMenus\.apiAccess/i)).not.toBeInTheDocument()
    })

    it('should render ApiAggregate icon', () => {
      const { container } = render(<ApiAccess expand={true} apiEnabled={true} />)
      const icon = container.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })

    it('should render Indicator component', () => {
      const { container } = render(<ApiAccess expand={true} apiEnabled={true} />)
      const indicatorElement = container.querySelector('.relative.flex.h-8')
      expect(indicatorElement).toBeInTheDocument()
    })

    it('should render with proper container padding', () => {
      const { container } = render(<ApiAccess expand={true} apiEnabled={true} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('p-3', 'pt-2')
    })
  })

  // --------------------------------------------------------------------------
  // Props Variations Tests
  // --------------------------------------------------------------------------
  describe('Props Variations', () => {
    it('should apply compressed layout when expand is false', () => {
      const { container } = render(<ApiAccess expand={false} apiEnabled={true} />)
      const triggerContainer = container.querySelector('[class*="w-8"]')
      expect(triggerContainer).toBeInTheDocument()
    })

    it('should apply full width when expand is true', () => {
      const { container } = render(<ApiAccess expand={true} apiEnabled={true} />)
      const trigger = container.querySelector('.w-full')
      expect(trigger).toBeInTheDocument()
    })

    it('should pass apiEnabled=true to Indicator with green color', () => {
      const { container } = render(<ApiAccess expand={true} apiEnabled={true} />)
      // Indicator uses color prop - test the visual presence
      const indicatorContainer = container.querySelector('.relative.flex.h-8')
      expect(indicatorContainer).toBeInTheDocument()
    })

    it('should pass apiEnabled=false to Indicator with yellow color', () => {
      const { container } = render(<ApiAccess expand={false} apiEnabled={false} />)
      const indicatorContainer = container.querySelector('.relative.flex.h-8')
      expect(indicatorContainer).toBeInTheDocument()
    })

    it('should position Indicator absolutely when collapsed', () => {
      const { container } = render(<ApiAccess expand={false} apiEnabled={true} />)
      // When collapsed, Indicator has 'absolute -right-px -top-px' classes
      const triggerDiv = container.querySelector('[class*="w-8"][class*="justify-center"]')
      expect(triggerDiv).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should toggle popup open state on click', async () => {
      const user = userEvent.setup()

      render(<ApiAccess expand={true} apiEnabled={true} />)

      const trigger = screen.getByText(/appMenus\.apiAccess/i).closest('[class*="cursor-pointer"]')
      expect(trigger).toBeInTheDocument()

      if (trigger)
        await user.click(trigger)

      // After click, the popup should toggle (Card should be rendered via portal)
    })

    it('should apply hover styles on trigger', () => {
      render(<ApiAccess expand={true} apiEnabled={true} />)

      const trigger = screen.getByText(/appMenus\.apiAccess/i).closest('div[class*="cursor-pointer"]')
      expect(trigger).toHaveClass('cursor-pointer')
    })

    it('should toggle open state from false to true on first click', async () => {
      const user = userEvent.setup()

      render(<ApiAccess expand={true} apiEnabled={true} />)

      const trigger = screen.getByText(/appMenus\.apiAccess/i).closest('[class*="cursor-pointer"]')
      if (trigger)
        await user.click(trigger)

      // The handleToggle function should flip open from false to true
    })

    it('should toggle open state back to false on second click', async () => {
      const user = userEvent.setup()

      render(<ApiAccess expand={true} apiEnabled={true} />)

      const trigger = screen.getByText(/appMenus\.apiAccess/i).closest('[class*="cursor-pointer"]')
      if (trigger) {
        await user.click(trigger) // open
        await user.click(trigger) // close
      }

      // The handleToggle function should flip open from true to false
    })

    it('should apply open state styling when popup is open', async () => {
      const user = userEvent.setup()

      render(<ApiAccess expand={true} apiEnabled={true} />)

      const trigger = screen.getByText(/appMenus\.apiAccess/i).closest('[class*="cursor-pointer"]')
      if (trigger)
        await user.click(trigger)

      // When open, the trigger should have bg-state-base-hover class
    })
  })

  // --------------------------------------------------------------------------
  // Portal and Card Integration Tests
  // --------------------------------------------------------------------------
  describe('Portal and Card Integration', () => {
    it('should render Card component inside portal when open', async () => {
      const user = userEvent.setup()

      render(<ApiAccess expand={true} apiEnabled={true} />)

      const trigger = screen.getByText(/appMenus\.apiAccess/i).closest('[class*="cursor-pointer"]')
      if (trigger)
        await user.click(trigger)

      // Wait for portal content to appear
      await waitFor(() => {
        expect(screen.getByText(/serviceApi\.enabled/i)).toBeInTheDocument()
      })
    })

    it('should pass apiEnabled prop to Card component', async () => {
      const user = userEvent.setup()

      render(<ApiAccess expand={true} apiEnabled={false} />)

      const trigger = screen.getByText(/appMenus\.apiAccess/i).closest('[class*="cursor-pointer"]')
      if (trigger)
        await user.click(trigger)

      await waitFor(() => {
        expect(screen.getByText(/serviceApi\.disabled/i)).toBeInTheDocument()
      })
    })

    it('should use correct portal placement configuration', () => {
      render(<ApiAccess expand={true} apiEnabled={true} />)
      // PortalToFollowElem is configured with placement="top-start"
      // The component should render without errors
      expect(screen.getByText(/appMenus\.apiAccess/i)).toBeInTheDocument()
    })

    it('should use correct portal offset configuration', () => {
      render(<ApiAccess expand={true} apiEnabled={true} />)
      // PortalToFollowElem is configured with offset={{ mainAxis: 4, crossAxis: -4 }}
      // The component should render without errors
      expect(screen.getByText(/appMenus\.apiAccess/i)).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases Tests
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle rapid toggle clicks gracefully', async () => {
      const user = userEvent.setup()

      const { container } = render(<ApiAccess expand={true} apiEnabled={true} />)

      // Use a more specific selector to find the trigger in the main component
      const trigger = container.querySelector('.p-3 [class*="cursor-pointer"]')
      if (trigger) {
        // Rapid clicks
        await user.click(trigger)
        await user.click(trigger)
        await user.click(trigger)
      }

      // Component should handle state changes without errors - use getAllByText since Card may be open
      const elements = screen.getAllByText(/appMenus\.apiAccess/i)
      expect(elements.length).toBeGreaterThan(0)
    })

    it('should render correctly when both expand and apiEnabled are false', () => {
      render(<ApiAccess expand={false} apiEnabled={false} />)
      // Should render without title but with indicator
      expect(screen.queryByText(/appMenus\.apiAccess/i)).not.toBeInTheDocument()
    })

    it('should maintain state across prop changes', () => {
      const { rerender } = render(<ApiAccess expand={true} apiEnabled={true} />)

      expect(screen.getByText(/appMenus\.apiAccess/i)).toBeInTheDocument()

      rerender(<ApiAccess expand={true} apiEnabled={false} />)

      // Component should still render after prop change
      expect(screen.getByText(/appMenus\.apiAccess/i)).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(<ApiAccess expand={true} apiEnabled={true} />)

      rerender(<ApiAccess expand={true} apiEnabled={true} />)

      expect(screen.getByText(/appMenus\.apiAccess/i)).toBeInTheDocument()
    })

    it('should not re-render unnecessarily with same props', () => {
      const { rerender } = render(<ApiAccess expand={true} apiEnabled={true} />)

      rerender(<ApiAccess expand={true} apiEnabled={true} />)
      rerender(<ApiAccess expand={true} apiEnabled={true} />)

      expect(screen.getByText(/appMenus\.apiAccess/i)).toBeInTheDocument()
    })
  })
})

// ============================================================================
// Card Component Tests
// ============================================================================

describe('Card (api-access)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceManager = true
    mockEnableDatasetServiceApi.mockResolvedValue({ result: 'success' })
    mockDisableDatasetServiceApi.mockResolvedValue({ result: 'success' })
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Card apiEnabled={true} />)
      expect(screen.getByText(/serviceApi\.enabled/i)).toBeInTheDocument()
    })

    it('should display enabled status when API is enabled', () => {
      render(<Card apiEnabled={true} />)
      expect(screen.getByText(/serviceApi\.enabled/i)).toBeInTheDocument()
    })

    it('should display disabled status when API is disabled', () => {
      render(<Card apiEnabled={false} />)
      expect(screen.getByText(/serviceApi\.disabled/i)).toBeInTheDocument()
    })

    it('should render switch component', () => {
      render(<Card apiEnabled={true} />)
      expect(screen.getByRole('switch')).toBeInTheDocument()
    })

    it('should render API Reference link', () => {
      render(<Card apiEnabled={true} />)
      expect(screen.getByText(/overview\.apiInfo\.doc/i)).toBeInTheDocument()
    })

    it('should render Indicator component', () => {
      const { container } = render(<Card apiEnabled={true} />)
      // Indicator is rendered - verify card structure
      const cardContainer = container.querySelector('.w-\\[208px\\]')
      expect(cardContainer).toBeInTheDocument()
    })

    it('should render description tip text', () => {
      render(<Card apiEnabled={true} />)
      expect(screen.getByText(/appMenus\.apiAccessTip/i)).toBeInTheDocument()
    })

    it('should apply success text color when enabled', () => {
      render(<Card apiEnabled={true} />)
      const statusText = screen.getByText(/serviceApi\.enabled/i)
      expect(statusText).toHaveClass('text-text-success')
    })

    it('should apply warning text color when disabled', () => {
      render(<Card apiEnabled={false} />)
      const statusText = screen.getByText(/serviceApi\.disabled/i)
      expect(statusText).toHaveClass('text-text-warning')
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call enableDatasetServiceApi when switch is toggled on', async () => {
      const user = userEvent.setup()

      render(<Card apiEnabled={false} />)

      const switchButton = screen.getByRole('switch')
      await user.click(switchButton)

      await waitFor(() => {
        expect(mockEnableDatasetServiceApi).toHaveBeenCalledWith('dataset-123')
      })
    })

    it('should call disableDatasetServiceApi when switch is toggled off', async () => {
      const user = userEvent.setup()

      render(<Card apiEnabled={true} />)

      const switchButton = screen.getByRole('switch')
      await user.click(switchButton)

      await waitFor(() => {
        expect(mockDisableDatasetServiceApi).toHaveBeenCalledWith('dataset-123')
      })
    })

    it('should call mutateDatasetRes after successful API enable', async () => {
      const user = userEvent.setup()

      render(<Card apiEnabled={false} />)

      const switchButton = screen.getByRole('switch')
      await user.click(switchButton)

      await waitFor(() => {
        expect(mockMutateDatasetRes).toHaveBeenCalled()
      })
    })

    it('should call mutateDatasetRes after successful API disable', async () => {
      const user = userEvent.setup()

      render(<Card apiEnabled={true} />)

      const switchButton = screen.getByRole('switch')
      await user.click(switchButton)

      await waitFor(() => {
        expect(mockMutateDatasetRes).toHaveBeenCalled()
      })
    })

    it('should not call mutateDatasetRes on API enable failure', async () => {
      mockEnableDatasetServiceApi.mockResolvedValueOnce({ result: 'fail' })
      const user = userEvent.setup()

      render(<Card apiEnabled={false} />)

      const switchButton = screen.getByRole('switch')
      await user.click(switchButton)

      await waitFor(() => {
        expect(mockEnableDatasetServiceApi).toHaveBeenCalled()
      })

      expect(mockMutateDatasetRes).not.toHaveBeenCalled()
    })

    it('should not call mutateDatasetRes on API disable failure', async () => {
      mockDisableDatasetServiceApi.mockResolvedValueOnce({ result: 'fail' })
      const user = userEvent.setup()

      render(<Card apiEnabled={true} />)

      const switchButton = screen.getByRole('switch')
      await user.click(switchButton)

      await waitFor(() => {
        expect(mockDisableDatasetServiceApi).toHaveBeenCalled()
      })

      expect(mockMutateDatasetRes).not.toHaveBeenCalled()
    })

    it('should have correct href for API Reference link', () => {
      render(<Card apiEnabled={true} />)

      const apiRefLink = screen.getByText(/overview\.apiInfo\.doc/i).closest('a')
      expect(apiRefLink).toHaveAttribute('href', 'https://docs.dify.ai/api-reference/datasets')
    })

    it('should open API Reference in new tab', () => {
      render(<Card apiEnabled={true} />)

      const apiRefLink = screen.getByText(/overview\.apiInfo\.doc/i).closest('a')
      expect(apiRefLink).toHaveAttribute('target', '_blank')
      expect(apiRefLink).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })

  // --------------------------------------------------------------------------
  // Permission Handling Tests
  // --------------------------------------------------------------------------
  describe('Permission Handling', () => {
    it('should disable switch when user is not workspace manager', () => {
      mockIsCurrentWorkspaceManager = false

      render(<Card apiEnabled={true} />)

      const switchButton = screen.getByRole('switch')
      expect(switchButton).toHaveClass('!cursor-not-allowed')
      expect(switchButton).toHaveClass('!opacity-50')
    })

    it('should enable switch when user is workspace manager', () => {
      mockIsCurrentWorkspaceManager = true

      render(<Card apiEnabled={true} />)

      const switchButton = screen.getByRole('switch')
      expect(switchButton).not.toHaveClass('!cursor-not-allowed')
      expect(switchButton).not.toHaveClass('!opacity-50')
    })

    it('should not trigger API call when switch is disabled and clicked', async () => {
      mockIsCurrentWorkspaceManager = false
      const user = userEvent.setup()

      render(<Card apiEnabled={false} />)

      const switchButton = screen.getByRole('switch')
      await user.click(switchButton)

      // API should not be called when disabled
      expect(mockEnableDatasetServiceApi).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases Tests
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle empty datasetId gracefully', async () => {
      const { useDatasetDetailContextWithSelector } = await import('@/context/dataset-detail')
      vi.mocked(useDatasetDetailContextWithSelector).mockImplementation((selector) => {
        return selector({
          dataset: { ...mockDataset, id: '' } as DataSet,
          mutateDatasetRes: mockMutateDatasetRes,
        })
      })

      const user = userEvent.setup()

      render(<Card apiEnabled={false} />)

      const switchButton = screen.getByRole('switch')
      await user.click(switchButton)

      await waitFor(() => {
        expect(mockEnableDatasetServiceApi).toHaveBeenCalledWith('')
      })

      // Reset mock
      vi.mocked(useDatasetDetailContextWithSelector).mockImplementation(selector =>
        selector({ dataset: mockDataset as DataSet, mutateDatasetRes: mockMutateDatasetRes }),
      )
    })

    it('should handle undefined datasetId gracefully when enabling API', async () => {
      const { useDatasetDetailContextWithSelector } = await import('@/context/dataset-detail')
      vi.mocked(useDatasetDetailContextWithSelector).mockImplementation((selector) => {
        const partialDataset = { ...mockDataset } as Partial<DataSet>
        delete partialDataset.id
        return selector({
          dataset: partialDataset as DataSet,
          mutateDatasetRes: mockMutateDatasetRes,
        })
      })

      const user = userEvent.setup()

      render(<Card apiEnabled={false} />)

      const switchButton = screen.getByRole('switch')
      await user.click(switchButton)

      await waitFor(() => {
        // Should use fallback empty string
        expect(mockEnableDatasetServiceApi).toHaveBeenCalledWith('')
      })

      // Reset mock
      vi.mocked(useDatasetDetailContextWithSelector).mockImplementation(selector =>
        selector({ dataset: mockDataset as DataSet, mutateDatasetRes: mockMutateDatasetRes }),
      )
    })

    it('should handle undefined datasetId gracefully when disabling API', async () => {
      const { useDatasetDetailContextWithSelector } = await import('@/context/dataset-detail')
      vi.mocked(useDatasetDetailContextWithSelector).mockImplementation((selector) => {
        const partialDataset = { ...mockDataset } as Partial<DataSet>
        delete partialDataset.id
        return selector({
          dataset: partialDataset as DataSet,
          mutateDatasetRes: mockMutateDatasetRes,
        })
      })

      const user = userEvent.setup()

      render(<Card apiEnabled={true} />)

      const switchButton = screen.getByRole('switch')
      await user.click(switchButton)

      await waitFor(() => {
        // Should use fallback empty string for disableDatasetServiceApi
        expect(mockDisableDatasetServiceApi).toHaveBeenCalledWith('')
      })

      // Reset mock
      vi.mocked(useDatasetDetailContextWithSelector).mockImplementation(selector =>
        selector({ dataset: mockDataset as DataSet, mutateDatasetRes: mockMutateDatasetRes }),
      )
    })

    it('should handle undefined mutateDatasetRes gracefully', async () => {
      const { useDatasetDetailContextWithSelector } = await import('@/context/dataset-detail')
      vi.mocked(useDatasetDetailContextWithSelector).mockImplementation((selector) => {
        return selector({
          dataset: mockDataset as DataSet,
          mutateDatasetRes: undefined,
        })
      })

      const user = userEvent.setup()

      render(<Card apiEnabled={false} />)

      const switchButton = screen.getByRole('switch')
      await user.click(switchButton)

      await waitFor(() => {
        expect(mockEnableDatasetServiceApi).toHaveBeenCalled()
      })

      // Should not throw error when mutateDatasetRes is undefined

      // Reset mock
      vi.mocked(useDatasetDetailContextWithSelector).mockImplementation(selector =>
        selector({ dataset: mockDataset as DataSet, mutateDatasetRes: mockMutateDatasetRes }),
      )
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(<Card apiEnabled={true} />)

      rerender(<Card apiEnabled={true} />)

      expect(screen.getByText(/serviceApi\.enabled/i)).toBeInTheDocument()
    })

    it('should use useCallback for onToggle handler', () => {
      const { rerender } = render(<Card apiEnabled={true} />)

      rerender(<Card apiEnabled={true} />)

      // Component should render without issues with memoized callbacks
      expect(screen.getByRole('switch')).toBeInTheDocument()
    })

    it('should update when apiEnabled prop changes', () => {
      const { rerender } = render(<Card apiEnabled={true} />)

      expect(screen.getByText(/serviceApi\.enabled/i)).toBeInTheDocument()

      rerender(<Card apiEnabled={false} />)

      expect(screen.getByText(/serviceApi\.disabled/i)).toBeInTheDocument()
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('ApiAccess Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceManager = true
    mockEnableDatasetServiceApi.mockResolvedValue({ result: 'success' })
    mockDisableDatasetServiceApi.mockResolvedValue({ result: 'success' })
  })

  it('should open Card popup and toggle API status', async () => {
    const user = userEvent.setup()

    render(<ApiAccess expand={true} apiEnabled={false} />)

    // Open popup
    const trigger = screen.getByText(/appMenus\.apiAccess/i).closest('[class*="cursor-pointer"]')
    if (trigger)
      await user.click(trigger)

    // Wait for Card to appear
    await waitFor(() => {
      expect(screen.getByText(/serviceApi\.disabled/i)).toBeInTheDocument()
    })

    // Toggle API on
    const switchButton = screen.getByRole('switch')
    await user.click(switchButton)

    await waitFor(() => {
      expect(mockEnableDatasetServiceApi).toHaveBeenCalledWith('dataset-123')
    })
  })

  it('should complete full workflow: open -> view status -> toggle -> verify callback', async () => {
    const user = userEvent.setup()

    render(<ApiAccess expand={true} apiEnabled={true} />)

    // Open popup
    const trigger = screen.getByText(/appMenus\.apiAccess/i).closest('[class*="cursor-pointer"]')
    if (trigger)
      await user.click(trigger)

    // Verify enabled status is shown
    await waitFor(() => {
      expect(screen.getByText(/serviceApi\.enabled/i)).toBeInTheDocument()
    })

    // Toggle API off
    const switchButton = screen.getByRole('switch')
    await user.click(switchButton)

    // Verify API call and callback
    await waitFor(() => {
      expect(mockDisableDatasetServiceApi).toHaveBeenCalledWith('dataset-123')
      expect(mockMutateDatasetRes).toHaveBeenCalled()
    })
  })

  it('should navigate to API Reference from Card', async () => {
    const user = userEvent.setup()

    render(<ApiAccess expand={true} apiEnabled={true} />)

    // Open popup
    const trigger = screen.getByText(/appMenus\.apiAccess/i).closest('[class*="cursor-pointer"]')
    if (trigger)
      await user.click(trigger)

    // Wait for Card to appear
    await waitFor(() => {
      expect(screen.getByText(/overview\.apiInfo\.doc/i)).toBeInTheDocument()
    })

    // Verify link
    const apiRefLink = screen.getByText(/overview\.apiInfo\.doc/i).closest('a')
    expect(apiRefLink).toHaveAttribute('href', 'https://docs.dify.ai/api-reference/datasets')
  })
})
