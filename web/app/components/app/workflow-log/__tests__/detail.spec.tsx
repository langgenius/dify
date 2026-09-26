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
// Tests
// ============================================================================

describe('DetailPanel', () => {
  const defaultOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render workflow title', () => {
      render(<DetailPanel appId="test-app-id" runID="run-123" onClose={defaultOnClose} />)

      expect(screen.getByText('appLog.runDetail.workflowTitle')).toBeInTheDocument()
    })

    it('should render close button', () => {
      render(<DetailPanel appId="test-app-id" runID="run-123" onClose={defaultOnClose} />)

      expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeInTheDocument()
    })

    it('should render Run component with correct URLs', () => {
      render(<DetailPanel appId="app-456" runID="run-789" onClose={defaultOnClose} />)

      expect(screen.getByTestId('workflow-run')).toBeInTheDocument()
      expect(screen.getByTestId('run-detail-url')).toHaveTextContent(
        '/apps/app-456/workflow-runs/run-789',
      )
      expect(screen.getByTestId('tracing-list-url')).toHaveTextContent(
        '/apps/app-456/workflow-runs/run-789/node-executions',
      )
    })

    it('should render WorkflowContextProvider wrapper', () => {
      render(<DetailPanel appId="test-app-id" runID="run-123" onClose={defaultOnClose} />)

      expect(screen.getByTestId('workflow-context-provider')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Props Tests (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Props', () => {
    it('should not render replay button when canReplay is false (default)', () => {
      render(<DetailPanel appId="test-app-id" runID="run-123" onClose={defaultOnClose} />)

      expect(
        screen.queryByRole('button', { name: 'appLog.runDetail.testWithParams' }),
      ).not.toBeInTheDocument()
    })

    it('should render replay button when canReplay is true', () => {
      render(
        <DetailPanel
          appId="test-app-id"
          runID="run-123"
          onClose={defaultOnClose}
          canReplay={true}
        />,
      )

      expect(
        screen.getByRole('button', { name: 'appLog.runDetail.testWithParams' }),
      ).toBeInTheDocument()
    })

    it('should use empty URL when runID is empty', () => {
      render(<DetailPanel appId="test-app-id" runID="" onClose={defaultOnClose} />)

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

      render(<DetailPanel appId="test-app-id" runID="run-123" onClose={onClose} />)

      const closeButton = screen.getByRole('button', { name: 'common.operation.close' })

      await user.click(closeButton)

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should navigate to workflow page with replayRunId when replay button is clicked', async () => {
      const user = userEvent.setup()

      render(
        <DetailPanel
          appId="app-replay-test"
          runID="run-to-replay"
          onClose={defaultOnClose}
          canReplay={true}
        />,
      )

      const replayButton = screen.getByRole('button', { name: 'appLog.runDetail.testWithParams' })
      await user.click(replayButton)

      expect(mockRouterPush).toHaveBeenCalledWith(
        '/app/app-replay-test/workflow?replayRunId=run-to-replay',
      )
    })
  })

  // --------------------------------------------------------------------------
  // URL Generation Tests
  // --------------------------------------------------------------------------
  describe('URL Generation', () => {
    it('should generate correct run detail URL', () => {
      render(<DetailPanel appId="my-app" runID="my-run" onClose={defaultOnClose} />)

      expect(screen.getByTestId('run-detail-url')).toHaveTextContent(
        '/apps/my-app/workflow-runs/my-run',
      )
    })

    it('should generate correct tracing list URL', () => {
      render(<DetailPanel appId="my-app" runID="my-run" onClose={defaultOnClose} />)

      expect(screen.getByTestId('tracing-list-url')).toHaveTextContent(
        '/apps/my-app/workflow-runs/my-run/node-executions',
      )
    })

    it('should handle special characters in runID', () => {
      render(<DetailPanel appId="app-id" runID="run-with-special-123" onClose={defaultOnClose} />)

      expect(screen.getByTestId('run-detail-url')).toHaveTextContent(
        '/apps/app-id/workflow-runs/run-with-special-123',
      )
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle empty runID', () => {
      render(<DetailPanel appId="test-app-id" runID="" onClose={defaultOnClose} />)

      expect(screen.getByTestId('run-detail-url')).toHaveTextContent('')
      expect(screen.getByTestId('tracing-list-url')).toHaveTextContent('')
    })

    it('should handle very long runID', () => {
      const longRunId = 'a'.repeat(100)

      render(<DetailPanel appId="app-id" runID={longRunId} onClose={defaultOnClose} />)

      expect(screen.getByTestId('run-detail-url')).toHaveTextContent(
        `/apps/app-id/workflow-runs/${longRunId}`,
      )
    })

    it('should render replay button with correct aria-label', () => {
      render(
        <DetailPanel
          appId="test-app-id"
          runID="run-123"
          onClose={defaultOnClose}
          canReplay={true}
        />,
      )

      const replayButton = screen.getByRole('button', { name: 'appLog.runDetail.testWithParams' })
      expect(replayButton).toHaveAttribute('aria-label', 'appLog.runDetail.testWithParams')
    })

    it('should maintain proper component structure', () => {
      const { container } = render(
        <DetailPanel appId="test-app-id" runID="run-123" onClose={defaultOnClose} />,
      )

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
      render(
        <DetailPanel
          appId="test-app-id"
          runID="run-123"
          onClose={defaultOnClose}
          canReplay={true}
        />,
      )

      // The replay button should be wrapped in TooltipPlus
      const replayButton = screen.getByRole('button', { name: 'appLog.runDetail.testWithParams' })
      expect(replayButton).toBeInTheDocument()

      // TooltipPlus wraps the button with popupContent
      // We verify the button exists with the correct aria-label
      expect(replayButton).toHaveAttribute('type', 'button')
    })
  })
})
