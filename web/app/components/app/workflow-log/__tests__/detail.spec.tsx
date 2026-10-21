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
  default: ({
    appId,
    runDetailUrl,
    tracingListUrl,
  }: {
    appId: string
    runDetailUrl: string
    tracingListUrl: string
  }) => (
    <div data-testid="workflow-run">
      <span data-testid="run-app-id">{appId}</span>
      <span data-testid="run-detail-url">{runDetailUrl}</span>
      <span data-testid="tracing-list-url">{tracingListUrl}</span>
    </div>
  ),
}))

describe('DetailPanel', () => {
  const defaultOnClose = vi.fn()
  let appId = 'test-app-id'

  beforeEach(() => {
    vi.clearAllMocks()
    appId = 'test-app-id'
  })

  // --------------------------------------------------------------------------
  // Rendering Tests (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render Run component with correct URLs', () => {
      appId = 'app-456'

      render(<DetailPanel appId={appId} runID="run-789" onClose={defaultOnClose} />)

      expect(screen.getByTestId('workflow-run')).toBeInTheDocument()
      expect(screen.getByTestId('run-app-id')).toHaveTextContent('app-456')
      expect(screen.getByTestId('run-detail-url')).toHaveTextContent(
        '/apps/app-456/workflow-runs/run-789',
      )
      expect(screen.getByTestId('tracing-list-url')).toHaveTextContent(
        '/apps/app-456/workflow-runs/run-789/node-executions',
      )
    })
  })

  // --------------------------------------------------------------------------
  // Props Tests (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Props', () => {
    it('should not render replay button when canReplay is false (default)', () => {
      render(<DetailPanel appId={appId} runID="run-123" onClose={defaultOnClose} />)

      expect(
        screen.queryByRole('button', { name: 'appLog.runDetail.testWithParams' }),
      ).not.toBeInTheDocument()
    })

    it('should use empty URL when runID is empty', () => {
      render(<DetailPanel appId={appId} runID="" onClose={defaultOnClose} />)

      expect(screen.getByTestId('run-detail-url')).toBeEmptyDOMElement()
      expect(screen.getByTestId('tracing-list-url')).toBeEmptyDOMElement()
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call onClose when close button is clicked', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      render(<DetailPanel appId={appId} runID="run-123" onClose={onClose} />)

      const closeButton = screen.getByRole('button', { name: 'common.operation.close' })

      await user.click(closeButton)

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should navigate to workflow page with replayRunId when replay button is clicked', async () => {
      const user = userEvent.setup()
      appId = 'app-replay-test'

      render(
        <DetailPanel
          appId={appId}
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

  // --------------------------------------------------------------------------
  // Edge Cases (REQUIRED)
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Tooltip Tests
  // --------------------------------------------------------------------------
})
