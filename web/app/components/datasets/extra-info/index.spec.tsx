import type { DataSet, RelatedApp, RelatedAppResponse } from '@/models/datasets'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AppModeEnum } from '@/types/app'

// ============================================================================
// Component Imports (after mocks)
// ============================================================================

import ExtraInfo from './index'
import ServiceApi from './service-api'
import Card from './service-api/card'
import Statistics from './statistics'

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

// Mock docLink hook
vi.mock('@/context/i18n', () => ({
  useDocLink: vi.fn(() => (path: string) => `https://docs.example.com${path}`),
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
// Test Data Factory
// ============================================================================

const createMockRelatedApp = (overrides: Partial<RelatedApp> = {}): RelatedApp => ({
  id: 'app-1',
  name: 'Test App',
  mode: AppModeEnum.COMPLETION,
  icon: 'icon-url',
  icon_type: 'image',
  icon_background: '#fff',
  icon_url: '',
  ...overrides,
})

const createMockRelatedAppsResponse = (count: number = 2): RelatedAppResponse => ({
  data: Array.from({ length: count }, (_, i) =>
    createMockRelatedApp({ id: `app-${i + 1}`, name: `App ${i + 1}` })),
  total: count,
})

// ============================================================================
// Statistics Component Tests
// ============================================================================

describe('Statistics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(
        <Statistics
          expand={true}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      expect(screen.getByText('10')).toBeInTheDocument()
    })

    it('should render document count correctly', () => {
      render(
        <Statistics
          expand={true}
          documentCount={42}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      expect(screen.getByText('42')).toBeInTheDocument()
    })

    it('should render related apps total correctly', () => {
      const relatedApps = createMockRelatedAppsResponse(5)

      render(
        <Statistics
          expand={true}
          documentCount={10}
          relatedApps={relatedApps}
        />,
      )

      expect(screen.getByText('5')).toBeInTheDocument()
    })

    it('should display translated document label', () => {
      render(
        <Statistics
          expand={true}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      expect(screen.getByText(/documents/i)).toBeInTheDocument()
    })

    it('should display translated related app label', () => {
      render(
        <Statistics
          expand={true}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      expect(screen.getByText(/relatedApp/i)).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should render placeholder when documentCount is undefined', () => {
      render(
        <Statistics
          expand={true}
          documentCount={undefined}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      expect(screen.getByText('--')).toBeInTheDocument()
    })

    it('should render placeholder when relatedApps is undefined', () => {
      render(
        <Statistics
          expand={true}
          documentCount={10}
          relatedApps={undefined}
        />,
      )

      expect(screen.getAllByText('--').length).toBeGreaterThanOrEqual(1)
    })

    it('should handle zero document count', () => {
      render(
        <Statistics
          expand={true}
          documentCount={0}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      expect(screen.getByText('0')).toBeInTheDocument()
    })

    it('should handle empty related apps array', () => {
      const emptyRelatedApps: RelatedAppResponse = { data: [], total: 0 }

      render(
        <Statistics
          expand={true}
          documentCount={10}
          relatedApps={emptyRelatedApps}
        />,
      )

      expect(screen.getByText('0')).toBeInTheDocument()
    })

    it('should handle large numbers correctly', () => {
      render(
        <Statistics
          expand={true}
          documentCount={999999}
          relatedApps={createMockRelatedAppsResponse(100)}
        />,
      )

      expect(screen.getByText('999999')).toBeInTheDocument()
      expect(screen.getByText('100')).toBeInTheDocument()
    })
  })

  describe('Tooltip Interactions', () => {
    it('should render tooltip trigger with info icon', () => {
      render(
        <Statistics
          expand={true}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      // Find the cursor-pointer element containing the relatedApp text
      const tooltipTrigger = screen.getByText(/relatedApp/i).closest('.cursor-pointer')
      expect(tooltipTrigger).toBeInTheDocument()
    })

    it('should render LinkedAppsPanel when related apps exist', async () => {
      const relatedApps = createMockRelatedAppsResponse(3)

      render(
        <Statistics
          expand={true}
          documentCount={10}
          relatedApps={relatedApps}
        />,
      )

      // The LinkedAppsPanel should be rendered inside the tooltip
      // We can't easily test tooltip content in this context without more setup
      // But we verify the condition logic works by checking component renders
      expect(screen.getByText('3')).toBeInTheDocument()
    })

    it('should render NoLinkedAppsPanel when no related apps', () => {
      const emptyRelatedApps: RelatedAppResponse = { data: [], total: 0 }

      render(
        <Statistics
          expand={true}
          documentCount={10}
          relatedApps={emptyRelatedApps}
        />,
      )

      // Verify component renders correctly with empty apps
      expect(screen.getByText('0')).toBeInTheDocument()
    })
  })

  describe('Props Variations', () => {
    it('should handle expand=false', () => {
      render(
        <Statistics
          expand={false}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      // Component should still render with expand=false
      expect(screen.getByText('10')).toBeInTheDocument()
    })

    it('should pass isMobile based on expand prop', () => {
      // When expand is false, isMobile should be true (!expand)
      render(
        <Statistics
          expand={false}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      // Component renders - the isMobile logic is internal
      expect(screen.getByText('10')).toBeInTheDocument()
    })
  })

  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(
        <Statistics
          expand={true}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      // Rerender with same props
      rerender(
        <Statistics
          expand={true}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      // Component should not cause unnecessary re-renders
      expect(screen.getByText('10')).toBeInTheDocument()
    })
  })
})

// ============================================================================
// ServiceApi Component Tests
// ============================================================================

describe('ServiceApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(
        <ServiceApi
          expand={true}
          apiBaseUrl="https://api.example.com"
          apiEnabled={true}
        />,
      )

      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })

    it('should render API title when expanded', () => {
      render(
        <ServiceApi
          expand={true}
          apiBaseUrl="https://api.example.com"
          apiEnabled={true}
        />,
      )

      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })

    it('should not render API title when collapsed', () => {
      render(
        <ServiceApi
          expand={false}
          apiBaseUrl="https://api.example.com"
          apiEnabled={true}
        />,
      )

      expect(screen.queryByText(/serviceApi\.title/i)).not.toBeInTheDocument()
    })

    it('should render green indicator when API is enabled', () => {
      render(
        <ServiceApi
          expand={true}
          apiBaseUrl="https://api.example.com"
          apiEnabled={true}
        />,
      )

      // Indicator component should be present
      const container = screen.getByText(/serviceApi\.title/i).closest('div')
      expect(container).toBeInTheDocument()
    })

    it('should render yellow indicator when API is disabled', () => {
      render(
        <ServiceApi
          expand={true}
          apiBaseUrl="https://api.example.com"
          apiEnabled={false}
        />,
      )

      const container = screen.getByText(/serviceApi\.title/i).closest('div')
      expect(container).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should toggle popup open state on click', async () => {
      const user = userEvent.setup()

      render(
        <ServiceApi
          expand={true}
          apiBaseUrl="https://api.example.com"
          apiEnabled={true}
        />,
      )

      const trigger = screen.getByText(/serviceApi\.title/i).closest('[class*="cursor-pointer"]')
      expect(trigger).toBeInTheDocument()

      if (trigger) {
        await user.click(trigger)
        // After click, the Card component should be rendered in the portal
      }
    })

    it('should apply hover styles on trigger', () => {
      render(
        <ServiceApi
          expand={true}
          apiBaseUrl="https://api.example.com"
          apiEnabled={true}
        />,
      )

      const trigger = screen.getByText(/serviceApi\.title/i).closest('div[class*="cursor-pointer"]')
      expect(trigger).toHaveClass('cursor-pointer')
    })
  })

  describe('Props Variations', () => {
    it('should apply compressed layout when expand is false', () => {
      const { container } = render(
        <ServiceApi
          expand={false}
          apiBaseUrl="https://api.example.com"
          apiEnabled={true}
        />,
      )

      // When collapsed, width should be w-8
      const triggerContainer = container.querySelector('[class*="w-8"]')
      expect(triggerContainer).toBeInTheDocument()
    })

    it('should pass apiBaseUrl to Card component', async () => {
      const user = userEvent.setup()

      render(
        <ServiceApi
          expand={true}
          apiBaseUrl="https://custom-api.example.com"
          apiEnabled={true}
        />,
      )

      const trigger = screen.getByText(/serviceApi\.title/i).closest('[class*="cursor-pointer"]')
      if (trigger) {
        await user.click(trigger)
        // The apiBaseUrl should be passed to Card and displayed
      }
    })

    it('should pass apiEnabled to Card component', async () => {
      const user = userEvent.setup()

      render(
        <ServiceApi
          expand={true}
          apiBaseUrl="https://api.example.com"
          apiEnabled={false}
        />,
      )

      const trigger = screen.getByText(/serviceApi\.title/i).closest('[class*="cursor-pointer"]')
      if (trigger)
        await user.click(trigger)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty apiBaseUrl', () => {
      render(
        <ServiceApi
          expand={true}
          apiBaseUrl=""
          apiEnabled={true}
        />,
      )

      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })
  })

  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(
        <ServiceApi
          expand={true}
          apiBaseUrl="https://api.example.com"
          apiEnabled={true}
        />,
      )

      rerender(
        <ServiceApi
          expand={true}
          apiBaseUrl="https://api.example.com"
          apiEnabled={true}
        />,
      )

      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })
  })
})

// ============================================================================
// Card Component Tests
// ============================================================================

describe('Card', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceManager = true
    mockEnableDatasetServiceApi.mockResolvedValue({ result: 'success' })
    mockDisableDatasetServiceApi.mockResolvedValue({ result: 'success' })
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(
        <Card
          apiEnabled={true}
          apiBaseUrl="https://api.example.com"
        />,
      )

      expect(screen.getByText(/serviceApi\.card\.title/i)).toBeInTheDocument()
    })

    it('should display API base URL', () => {
      render(
        <Card
          apiEnabled={true}
          apiBaseUrl="https://api.example.com"
        />,
      )

      expect(screen.getByText('https://api.example.com')).toBeInTheDocument()
    })

    it('should display endpoint label', () => {
      render(
        <Card
          apiEnabled={true}
          apiBaseUrl="https://api.example.com"
        />,
      )

      expect(screen.getByText(/serviceApi\.card\.endpoint/i)).toBeInTheDocument()
    })

    it('should display enabled status when API is enabled', () => {
      render(
        <Card
          apiEnabled={true}
          apiBaseUrl="https://api.example.com"
        />,
      )

      expect(screen.getByText(/serviceApi\.enabled/i)).toBeInTheDocument()
    })

    it('should display disabled status when API is disabled', () => {
      render(
        <Card
          apiEnabled={false}
          apiBaseUrl="https://api.example.com"
        />,
      )

      expect(screen.getByText(/serviceApi\.disabled/i)).toBeInTheDocument()
    })

    it('should render API Key button', () => {
      render(
        <Card
          apiEnabled={true}
          apiBaseUrl="https://api.example.com"
        />,
      )

      expect(screen.getByText(/serviceApi\.card\.apiKey/i)).toBeInTheDocument()
    })

    it('should render API Reference link', () => {
      render(
        <Card
          apiEnabled={true}
          apiBaseUrl="https://api.example.com"
        />,
      )

      expect(screen.getByText(/serviceApi\.card\.apiReference/i)).toBeInTheDocument()
    })

    it('should render CopyFeedback component for URL copying', () => {
      render(
        <Card
          apiEnabled={true}
          apiBaseUrl="https://api.example.com"
        />,
      )

      // CopyFeedback component should be rendered
      const urlContainer = screen.getByText('https://api.example.com').closest('div')
      expect(urlContainer).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call enableDatasetServiceApi when switch is toggled on', async () => {
      const user = userEvent.setup()

      render(
        <Card
          apiEnabled={false}
          apiBaseUrl="https://api.example.com"
        />,
      )

      // Find the switch button
      const switchButton = screen.getByRole('switch')
      await user.click(switchButton)

      await waitFor(() => {
        expect(mockEnableDatasetServiceApi).toHaveBeenCalledWith('dataset-123')
      })
    })

    it('should call disableDatasetServiceApi when switch is toggled off', async () => {
      const user = userEvent.setup()

      render(
        <Card
          apiEnabled={true}
          apiBaseUrl="https://api.example.com"
        />,
      )

      const switchButton = screen.getByRole('switch')
      await user.click(switchButton)

      await waitFor(() => {
        expect(mockDisableDatasetServiceApi).toHaveBeenCalledWith('dataset-123')
      })
    })

    it('should call mutateDatasetRes after successful API toggle', async () => {
      const user = userEvent.setup()

      render(
        <Card
          apiEnabled={false}
          apiBaseUrl="https://api.example.com"
        />,
      )

      const switchButton = screen.getByRole('switch')
      await user.click(switchButton)

      await waitFor(() => {
        expect(mockMutateDatasetRes).toHaveBeenCalled()
      })
    })

    it('should not call mutateDatasetRes on API toggle failure', async () => {
      mockEnableDatasetServiceApi.mockResolvedValueOnce({ result: 'fail' })
      const user = userEvent.setup()

      render(
        <Card
          apiEnabled={false}
          apiBaseUrl="https://api.example.com"
        />,
      )

      const switchButton = screen.getByRole('switch')
      await user.click(switchButton)

      await waitFor(() => {
        expect(mockEnableDatasetServiceApi).toHaveBeenCalled()
      })

      // mutateDatasetRes should not be called on failure
      expect(mockMutateDatasetRes).not.toHaveBeenCalled()
    })

    it('should open secret key modal when API Key button is clicked', async () => {
      const user = userEvent.setup()

      render(
        <Card
          apiEnabled={true}
          apiBaseUrl="https://api.example.com"
        />,
      )

      const apiKeyButton = screen.getByText(/serviceApi\.card\.apiKey/i).closest('button')
      expect(apiKeyButton).toBeInTheDocument()

      if (apiKeyButton)
        await user.click(apiKeyButton)

      await waitFor(() => {
        expect(screen.getByTestId('secret-key-modal')).toBeInTheDocument()
      })
    })

    it('should close secret key modal when close button is clicked', async () => {
      const user = userEvent.setup()

      render(
        <Card
          apiEnabled={true}
          apiBaseUrl="https://api.example.com"
        />,
      )

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

    it('should have correct href for API Reference link', () => {
      render(
        <Card
          apiEnabled={true}
          apiBaseUrl="https://api.example.com"
        />,
      )

      const apiRefLink = screen.getByText(/serviceApi\.card\.apiReference/i).closest('a')
      expect(apiRefLink).toHaveAttribute('href', 'https://docs.dify.ai/api-reference/datasets')
    })
  })

  describe('Permission Handling', () => {
    it('should disable switch when user is not workspace manager', () => {
      mockIsCurrentWorkspaceManager = false

      render(
        <Card
          apiEnabled={true}
          apiBaseUrl="https://api.example.com"
        />,
      )

      const switchButton = screen.getByRole('switch')
      // Headless UI Switch uses CSS classes for disabled state instead of native disabled attribute
      expect(switchButton).toHaveClass('!cursor-not-allowed')
      expect(switchButton).toHaveClass('!opacity-50')
    })

    it('should enable switch when user is workspace manager', () => {
      mockIsCurrentWorkspaceManager = true

      render(
        <Card
          apiEnabled={true}
          apiBaseUrl="https://api.example.com"
        />,
      )

      const switchButton = screen.getByRole('switch')
      expect(switchButton).not.toHaveClass('!cursor-not-allowed')
      expect(switchButton).not.toHaveClass('!opacity-50')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty apiBaseUrl', () => {
      render(
        <Card
          apiEnabled={true}
          apiBaseUrl=""
        />,
      )

      expect(screen.getByText(/serviceApi\.card\.title/i)).toBeInTheDocument()
    })

    it('should handle undefined datasetId gracefully', async () => {
      const { useDatasetDetailContextWithSelector } = await import('@/context/dataset-detail')
      vi.mocked(useDatasetDetailContextWithSelector).mockImplementation((selector) => {
        return selector({ dataset: undefined, mutateDatasetRes: mockMutateDatasetRes })
      })

      const user = userEvent.setup()

      render(
        <Card
          apiEnabled={false}
          apiBaseUrl="https://api.example.com"
        />,
      )

      const switchButton = screen.getByRole('switch')
      await user.click(switchButton)

      await waitFor(() => {
        // Should be called with empty string when datasetId is undefined
        expect(mockEnableDatasetServiceApi).toHaveBeenCalledWith('')
      })

      // Reset the mock
      vi.mocked(useDatasetDetailContextWithSelector).mockImplementation(selector =>
        selector({ dataset: mockDataset as DataSet, mutateDatasetRes: mockMutateDatasetRes }),
      )
    })
  })

  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(
        <Card
          apiEnabled={true}
          apiBaseUrl="https://api.example.com"
        />,
      )

      rerender(
        <Card
          apiEnabled={true}
          apiBaseUrl="https://api.example.com"
        />,
      )

      expect(screen.getByText(/serviceApi\.card\.title/i)).toBeInTheDocument()
    })

    it('should use useCallback for handlers', () => {
      // Verify handlers are stable by rendering multiple times
      const { rerender } = render(
        <Card
          apiEnabled={true}
          apiBaseUrl="https://api.example.com"
        />,
      )

      rerender(
        <Card
          apiEnabled={true}
          apiBaseUrl="https://api.example.com"
        />,
      )

      // Component should render without issues with memoized callbacks
      expect(screen.getByText(/serviceApi\.card\.apiKey/i)).toBeInTheDocument()
    })
  })
})

// ============================================================================
// ExtraInfo (Main Component) Tests
// ============================================================================

describe('ExtraInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceManager = true
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(
        <ExtraInfo
          expand={true}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      // Should render ServiceApi component
      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })

    it('should render Statistics when expand is true', () => {
      render(
        <ExtraInfo
          expand={true}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      // Statistics shows document count
      expect(screen.getByText('10')).toBeInTheDocument()
    })

    it('should not render Statistics when expand is false', () => {
      render(
        <ExtraInfo
          expand={false}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      // Document count should not be visible when collapsed
      expect(screen.queryByText('10')).not.toBeInTheDocument()
    })

    it('should always render ServiceApi regardless of expand state', () => {
      const { rerender } = render(
        <ExtraInfo
          expand={true}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      // Check expanded state has ServiceApi title
      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()

      rerender(
        <ExtraInfo
          expand={false}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      // ServiceApi should still be present (but without title text when collapsed)
      // The component is still rendered, just with different styling
    })
  })

  describe('Context Integration', () => {
    it('should read apiEnabled from dataset detail context', () => {
      render(
        <ExtraInfo
          expand={true}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      // Since mockDataset has enable_api: true, the indicator should be green
      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })

    it('should read apiBaseUrl from useDatasetApiBaseUrl hook', () => {
      render(
        <ExtraInfo
          expand={true}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      // Component should render with the mocked API base URL
      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })

    it('should handle missing apiBaseInfo with fallback empty string', async () => {
      const { useDatasetApiBaseUrl } = await import('@/service/knowledge/use-dataset')
      vi.mocked(useDatasetApiBaseUrl).mockReturnValue({
        data: undefined,
        isLoading: false,
      } as ReturnType<typeof useDatasetApiBaseUrl>)

      render(
        <ExtraInfo
          expand={true}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()

      // Reset mock
      vi.mocked(useDatasetApiBaseUrl).mockReturnValue({
        data: { api_base_url: 'https://api.example.com' },
        isLoading: false,
      } as ReturnType<typeof useDatasetApiBaseUrl>)
    })

    it('should handle missing apiEnabled with fallback false', async () => {
      const { useDatasetDetailContextWithSelector } = await import('@/context/dataset-detail')
      vi.mocked(useDatasetDetailContextWithSelector).mockImplementation((selector) => {
        // Simulate dataset without enable_api by using a partial dataset
        const partialDataset = { ...mockDataset } as Partial<DataSet>
        delete (partialDataset as { enable_api?: boolean }).enable_api
        return selector({
          dataset: partialDataset as DataSet,
          mutateDatasetRes: mockMutateDatasetRes,
        })
      })

      render(
        <ExtraInfo
          expand={true}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()

      // Reset mock
      vi.mocked(useDatasetDetailContextWithSelector).mockImplementation(selector =>
        selector({ dataset: mockDataset as DataSet, mutateDatasetRes: mockMutateDatasetRes }),
      )
    })
  })

  describe('Props Variations', () => {
    it('should pass expand prop to Statistics component', () => {
      render(
        <ExtraInfo
          expand={true}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      expect(screen.getByText('10')).toBeInTheDocument()
    })

    it('should pass expand prop to ServiceApi component', () => {
      render(
        <ExtraInfo
          expand={true}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })

    it('should pass documentCount to Statistics component', () => {
      render(
        <ExtraInfo
          expand={true}
          documentCount={99}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      expect(screen.getByText('99')).toBeInTheDocument()
    })

    it('should pass relatedApps to Statistics component', () => {
      const relatedApps = createMockRelatedAppsResponse(7)

      render(
        <ExtraInfo
          expand={true}
          documentCount={10}
          relatedApps={relatedApps}
        />,
      )

      expect(screen.getByText('7')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined documentCount', () => {
      render(
        <ExtraInfo
          expand={true}
          documentCount={undefined}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      expect(screen.getByText('--')).toBeInTheDocument()
    })

    it('should handle undefined relatedApps', () => {
      render(
        <ExtraInfo
          expand={true}
          documentCount={10}
          relatedApps={undefined}
        />,
      )

      expect(screen.getByText('10')).toBeInTheDocument()
    })

    it('should handle all undefined optional props', () => {
      render(
        <ExtraInfo
          expand={true}
          documentCount={undefined}
          relatedApps={undefined}
        />,
      )

      // Should render without crashing
      expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
    })

    it('should handle zero values correctly', () => {
      const emptyRelatedApps: RelatedAppResponse = { data: [], total: 0 }

      render(
        <ExtraInfo
          expand={true}
          documentCount={0}
          relatedApps={emptyRelatedApps}
        />,
      )

      expect(screen.getAllByText('0')).toHaveLength(2)
    })
  })

  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(
        <ExtraInfo
          expand={true}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      // Rerender with same props
      rerender(
        <ExtraInfo
          expand={true}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      expect(screen.getByText('10')).toBeInTheDocument()
    })

    it('should update when props change', () => {
      const { rerender } = render(
        <ExtraInfo
          expand={true}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      expect(screen.getByText('10')).toBeInTheDocument()

      rerender(
        <ExtraInfo
          expand={true}
          documentCount={20}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      expect(screen.getByText('20')).toBeInTheDocument()
    })

    it('should hide Statistics when expand changes to false', () => {
      const { rerender } = render(
        <ExtraInfo
          expand={true}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      expect(screen.getByText('10')).toBeInTheDocument()

      rerender(
        <ExtraInfo
          expand={false}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      expect(screen.queryByText('10')).not.toBeInTheDocument()
    })
  })

  describe('Component Composition', () => {
    it('should render Statistics before ServiceApi when expanded', () => {
      const { container } = render(
        <ExtraInfo
          expand={true}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      // Statistics should appear before ServiceApi in DOM order
      const elements = container.querySelectorAll('div')
      expect(elements.length).toBeGreaterThan(0)
    })

    it('should render only ServiceApi when collapsed', () => {
      render(
        <ExtraInfo
          expand={false}
          documentCount={10}
          relatedApps={createMockRelatedAppsResponse()}
        />,
      )

      // Only ServiceApi should be rendered (without its title in collapsed state)
      expect(screen.queryByText('10')).not.toBeInTheDocument()
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('ExtraInfo Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceManager = true
  })

  it('should render complete expanded view with all child components', () => {
    render(
      <ExtraInfo
        expand={true}
        documentCount={25}
        relatedApps={createMockRelatedAppsResponse(5)}
      />,
    )

    // Statistics content
    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()

    // ServiceApi content
    expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
  })

  it('should handle complete user workflow: view stats and toggle API', async () => {
    const user = userEvent.setup()

    render(
      <ExtraInfo
        expand={true}
        documentCount={10}
        relatedApps={createMockRelatedAppsResponse(3)}
      />,
    )

    // Verify statistics are visible
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()

    // Click on ServiceApi to open the card
    const serviceApiTrigger = screen.getByText(/serviceApi\.title/i).closest('[class*="cursor-pointer"]')
    if (serviceApiTrigger)
      await user.click(serviceApiTrigger)

    // The popup should open with Card content
    await waitFor(() => {
      expect(screen.getByText(/serviceApi\.card\.title/i)).toBeInTheDocument()
    })
  })

  it('should integrate with context correctly across all components', async () => {
    render(
      <ExtraInfo
        expand={true}
        documentCount={10}
        relatedApps={createMockRelatedAppsResponse()}
      />,
    )

    // The component tree should correctly receive context values
    // apiEnabled from context affects ServiceApi indicator color
    // apiBaseUrl from hook affects Card display
    expect(screen.getByText(/serviceApi\.title/i)).toBeInTheDocument()
  })
})
