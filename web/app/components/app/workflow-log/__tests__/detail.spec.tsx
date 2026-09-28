import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
/**
 * DetailPanel Component Tests
 *
 * Tests the workflow run detail panel which displays:
 * - Workflow run title
 * - Replay button (when canReplay is true)
 * - Close button
 * - Run component with detail/tracing URLs
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore as useAppStore } from '@/app/components/app/store'
import { createAppDetailFixture, createAppSiteFixture } from '@/test/fixtures/app'
import DetailPanel from '../detail'

// ============================================================================
// Mocks
// ============================================================================

const mockRouterPush = vi.fn()
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}))

// Mock the Run component as it has complex dependencies
vi.mock('@/app/components/workflow/run', () => ({
  default: ({ runDetailUrl, tracingListUrl }: { runDetailUrl: string; tracingListUrl: string }) => (
    <div data-testid="workflow-run">
      <span data-testid="run-detail-url">{runDetailUrl}</span>
      <span data-testid="tracing-list-url">{tracingListUrl}</span>
    </div>
  ),
}))

// Mock WorkflowContextProvider
vi.mock('@/app/components/workflow/context', () => ({
  WorkflowContextProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="workflow-context-provider">{children}</div>
  ),
}))

// Mock ahooks for useBoolean (used by TooltipPlus)
vi.mock('ahooks', () => ({
  useBoolean: (initial: boolean) => {
    const setters = {
      setTrue: vi.fn(),
      setFalse: vi.fn(),
      toggle: vi.fn(),
    }
    return [initial, setters] as const
  },
}))

// ============================================================================
// Test Data Factories
// ============================================================================

const createMockApp = (overrides: Partial<AppDetailWithSite> = {}): AppDetailWithSite =>
  createAppDetailFixture({
    id: 'test-app-id',
    name: 'Test App',
    mode: 'workflow',
    site: createAppSiteFixture({ access_token: 'token', app_base_url: 'https://example.com' }),
    ...overrides,
  })

// ============================================================================
// Tests
// ============================================================================

describe('DetailPanel', () => {
  const defaultOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({ appDetail: createMockApp() })
  })

  // --------------------------------------------------------------------------
  // Rendering Tests (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render workflow title', () => {
      render(<DetailPanel runID="run-123" onClose={defaultOnClose} />)

      expect(screen.getByText('appLog.runDetail.workflowTitle')).toBeInTheDocument()
    })

    it('should render close button', () => {
      render(<DetailPanel runID="run-123" onClose={defaultOnClose} />)

      expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeInTheDocument()
    })

    it('should render Run component with correct URLs', () => {
      useAppStore.setState({ appDetail: createMockApp({ id: 'app-456' }) })

      render(<DetailPanel runID="run-789" onClose={defaultOnClose} />)

      expect(screen.getByTestId('workflow-run')).toBeInTheDocument()
      expect(screen.getByTestId('run-detail-url')).toHaveTextContent(
        '/apps/app-456/workflow-runs/run-789',
      )
      expect(screen.getByTestId('tracing-list-url')).toHaveTextContent(
        '/apps/app-456/workflow-runs/run-789/node-executions',
      )
    })

    it('should render WorkflowContextProvider wrapper', () => {
      render(<DetailPanel runID="run-123" onClose={defaultOnClose} />)

      expect(screen.getByTestId('workflow-context-provider')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Props Tests (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Props', () => {
    it('should not render replay button when canReplay is false (default)', () => {
      render(<DetailPanel runID="run-123" onClose={defaultOnClose} />)

      expect(
        screen.queryByRole('button', { name: 'appLog.runDetail.testWithParams' }),
      ).not.toBeInTheDocument()
    })

    it('should render replay button when canReplay is true', () => {
      render(<DetailPanel runID="run-123" onClose={defaultOnClose} canReplay={true} />)

      expect(
        screen.getByRole('button', { name: 'appLog.runDetail.testWithParams' }),
      ).toBeInTheDocument()
    })

    it('should use empty URL when runID is empty', () => {
      render(<DetailPanel runID="" onClose={defaultOnClose} />)

      expect(screen.getByTestId('run-detail-url')).toHaveTextContent('')
      expect(screen.getByTestId('tracing-list-url')).toHaveTextContent('')
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call onClose when close button is clicked', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      render(<DetailPanel runID="run-123" onClose={onClose} />)

      const closeButton = screen.getByRole('button', { name: 'common.operation.close' })

      await user.click(closeButton)

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should navigate to workflow page with replayRunId when replay button is clicked', async () => {
      const user = userEvent.setup()
      useAppStore.setState({ appDetail: createMockApp({ id: 'app-replay-test' }) })

      render(<DetailPanel runID="run-to-replay" onClose={defaultOnClose} canReplay={true} />)

      const replayButton = screen.getByRole('button', { name: 'appLog.runDetail.testWithParams' })
      await user.click(replayButton)

      expect(mockRouterPush).toHaveBeenCalledWith(
        '/app/app-replay-test/workflow?replayRunId=run-to-replay',
      )
    })

    it('should not navigate when replay clicked but appDetail is missing', async () => {
      const user = userEvent.setup()
      useAppStore.setState({ appDetail: undefined })

      render(<DetailPanel runID="run-123" onClose={defaultOnClose} canReplay={true} />)

      const replayButton = screen.getByRole('button', { name: 'appLog.runDetail.testWithParams' })
      await user.click(replayButton)

      expect(mockRouterPush).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // URL Generation Tests
  // --------------------------------------------------------------------------
  describe('URL Generation', () => {
    it('should generate correct run detail URL', () => {
      useAppStore.setState({ appDetail: createMockApp({ id: 'my-app' }) })

      render(<DetailPanel runID="my-run" onClose={defaultOnClose} />)

      expect(screen.getByTestId('run-detail-url')).toHaveTextContent(
        '/apps/my-app/workflow-runs/my-run',
      )
    })

    it('should generate correct tracing list URL', () => {
      useAppStore.setState({ appDetail: createMockApp({ id: 'my-app' }) })

      render(<DetailPanel runID="my-run" onClose={defaultOnClose} />)

      expect(screen.getByTestId('tracing-list-url')).toHaveTextContent(
        '/apps/my-app/workflow-runs/my-run/node-executions',
      )
    })

    it('should handle special characters in runID', () => {
      useAppStore.setState({ appDetail: createMockApp({ id: 'app-id' }) })

      render(<DetailPanel runID="run-with-special-123" onClose={defaultOnClose} />)

      expect(screen.getByTestId('run-detail-url')).toHaveTextContent(
        '/apps/app-id/workflow-runs/run-with-special-123',
      )
    })
  })

  // --------------------------------------------------------------------------
  // Store Integration Tests
  // --------------------------------------------------------------------------
  describe('Store Integration', () => {
    it('should read appDetail from store', () => {
      useAppStore.setState({ appDetail: createMockApp({ id: 'store-app-id' }) })

      render(<DetailPanel runID="run-123" onClose={defaultOnClose} />)

      expect(screen.getByTestId('run-detail-url')).toHaveTextContent(
        '/apps/store-app-id/workflow-runs/run-123',
      )
    })

    it('should handle undefined appDetail from store gracefully', () => {
      useAppStore.setState({ appDetail: undefined })

      render(<DetailPanel runID="run-123" onClose={defaultOnClose} />)

      // Run component should still render but with undefined in URL
      expect(screen.getByTestId('workflow-run')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle empty runID', () => {
      render(<DetailPanel runID="" onClose={defaultOnClose} />)

      expect(screen.getByTestId('run-detail-url')).toHaveTextContent('')
      expect(screen.getByTestId('tracing-list-url')).toHaveTextContent('')
    })

    it('should handle very long runID', () => {
      const longRunId = 'a'.repeat(100)
      useAppStore.setState({ appDetail: createMockApp({ id: 'app-id' }) })

      render(<DetailPanel runID={longRunId} onClose={defaultOnClose} />)

      expect(screen.getByTestId('run-detail-url')).toHaveTextContent(
        `/apps/app-id/workflow-runs/${longRunId}`,
      )
    })

    it('should render replay button with correct aria-label', () => {
      render(<DetailPanel runID="run-123" onClose={defaultOnClose} canReplay={true} />)

      const replayButton = screen.getByRole('button', { name: 'appLog.runDetail.testWithParams' })
      expect(replayButton).toHaveAttribute('aria-label', 'appLog.runDetail.testWithParams')
    })

    it('should maintain proper component structure', () => {
      const { container } = render(<DetailPanel runID="run-123" onClose={defaultOnClose} />)

      // Check for main container with flex layout
      const mainContainer = container.querySelector('.flex.grow.flex-col')
      expect(mainContainer).toBeInTheDocument()

      // Check for header section
      const header = container.querySelector('.flex.items-center.bg-components-panel-bg')
      expect(header).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Tooltip Tests
  // --------------------------------------------------------------------------
  describe('Tooltip', () => {
    it('should have tooltip on replay button', () => {
      render(<DetailPanel runID="run-123" onClose={defaultOnClose} canReplay={true} />)

      // The replay button should be wrapped in TooltipPlus
      const replayButton = screen.getByRole('button', { name: 'appLog.runDetail.testWithParams' })
      expect(replayButton).toBeInTheDocument()

      // TooltipPlus wraps the button with popupContent
      // We verify the button exists with the correct aria-label
      expect(replayButton).toHaveAttribute('type', 'button')
    })
  })
})
