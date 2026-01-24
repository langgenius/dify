import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { HeaderProps } from '@/app/components/workflow/header'
import type { App } from '@/types/app'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { AppModeEnum } from '@/types/app'
import WorkflowHeader from './index'

const mockResetWorkflowVersionHistory = vi.fn()

const createMockApp = (overrides: Partial<App> = {}): App => ({
  id: 'app-id',
  name: 'Workflow App',
  description: 'Workflow app description',
  author_name: 'Workflow app author',
  icon_type: 'emoji',
  icon: 'app-icon',
  icon_background: '#FFFFFF',
  icon_url: null,
  use_icon_as_answer_icon: false,
  mode: AppModeEnum.COMPLETION,
  enable_site: true,
  enable_api: true,
  api_rpm: 60,
  api_rph: 3600,
  is_demo: false,
  model_config: {} as App['model_config'],
  app_model_config: {} as App['app_model_config'],
  created_at: 0,
  updated_at: 0,
  site: {
    access_token: 'token',
    app_base_url: 'https://example.com',
  } as App['site'],
  api_base_url: 'https://api.example.com',
  tags: [],
  access_mode: 'public_access' as App['access_mode'],
  ...overrides,
})

// Helper to set up app store state
const setupAppStore = (overrides: Partial<App> = {}) => {
  const appDetail = createMockApp(overrides)
  useAppStore.setState({ appDetail })
  return appDetail
}

// Use real store - global zustand mock will auto-reset between tests

vi.mock('@/app/components/workflow/header', () => ({
  default: (props: HeaderProps) => {
    return (
      <div
        data-testid="workflow-header"
        data-show-run={String(Boolean(props.normal?.runAndHistoryProps?.showRunButton))}
        data-show-preview={String(Boolean(props.normal?.runAndHistoryProps?.showPreviewButton))}
        data-history-url={props.normal?.runAndHistoryProps?.viewHistoryProps?.historyUrl ?? ''}
      >
        <button
          type="button"
          onClick={() => props.normal?.runAndHistoryProps?.viewHistoryProps?.onClearLogAndMessageModal?.()}
        >
          clear-history
        </button>
        <button
          type="button"
          onClick={() => props.restoring?.onRestoreSettled?.()}
        >
          restore-settled
        </button>
      </div>
    )
  },
}))

vi.mock('@/service/use-workflow', () => ({
  useResetWorkflowVersionHistory: () => mockResetWorkflowVersionHistory,
}))

describe('WorkflowHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupAppStore()
  })

  afterEach(() => {
    // Cleanup before zustand mock resets store to avoid re-render with undefined appDetail
    cleanup()
  })

  // Verifies the wrapper renders the workflow header shell.
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Act
      render(<WorkflowHeader />)

      // Assert
      expect(screen.getByTestId('workflow-header')).toBeInTheDocument()
    })
  })

  // Verifies chat mode affects which primary action is shown in the header.
  describe('Props', () => {
    it('should configure preview mode when app is in advanced chat mode', () => {
      // Arrange
      setupAppStore({ mode: AppModeEnum.ADVANCED_CHAT })

      // Act
      render(<WorkflowHeader />)

      // Assert
      const header = screen.getByTestId('workflow-header')
      expect(header).toHaveAttribute('data-show-run', 'false')
      expect(header).toHaveAttribute('data-show-preview', 'true')
      expect(header).toHaveAttribute('data-history-url', '/apps/app-id/advanced-chat/workflow-runs')
    })

    it('should configure run mode when app is not in advanced chat mode', () => {
      // Arrange
      setupAppStore({ mode: AppModeEnum.COMPLETION })

      // Act
      render(<WorkflowHeader />)

      // Assert
      const header = screen.getByTestId('workflow-header')
      expect(header).toHaveAttribute('data-show-run', 'true')
      expect(header).toHaveAttribute('data-show-preview', 'false')
      expect(header).toHaveAttribute('data-history-url', '/apps/app-id/workflow-runs')
    })
  })

  // Verifies callbacks clear log state as expected.
  describe('User Interactions', () => {
    it('should clear log and close message modal when clearing history modal state', () => {
      // Arrange
      useAppStore.setState({
        currentLogItem: { id: 'log-item' } as unknown as IChatItem,
        showMessageLogModal: true,
      })
      render(<WorkflowHeader />)

      // Act
      fireEvent.click(screen.getByRole('button', { name: /clear-history/i }))

      // Assert - verify store state was updated
      expect(useAppStore.getState().currentLogItem).toBeUndefined()
      expect(useAppStore.getState().showMessageLogModal).toBe(false)
    })
  })

  // Ensures restoring callback is wired to reset version history.
  describe('Edge Cases', () => {
    it('should use resetWorkflowVersionHistory as restore settled handler', () => {
      // Act
      render(<WorkflowHeader />)

      // Assert
      fireEvent.click(screen.getByRole('button', { name: /restore-settled/i }))
      expect(mockResetWorkflowVersionHistory).toHaveBeenCalled()
    })
  })
})
