import { render, screen } from '@testing-library/react'
import type { App } from '@/types/app'
import { AppModeEnum } from '@/types/app'
import type { HeaderProps } from '@/app/components/workflow/header'
import WorkflowHeader from './index'

const mockUseAppStoreSelector = vi.fn()
const mockSetCurrentLogItem = vi.fn()
const mockSetShowMessageLogModal = vi.fn()
const mockResetWorkflowVersionHistory = vi.fn()

let appDetail: App

vi.mock('@/app/components/app/store', () => ({
  __esModule: true,
  useStore: (selector: (state: { appDetail?: App; setCurrentLogItem: typeof mockSetCurrentLogItem; setShowMessageLogModal: typeof mockSetShowMessageLogModal }) => unknown) => mockUseAppStoreSelector(selector),
}))

vi.mock('@/app/components/workflow/header', () => ({
  __esModule: true,
  default: (props: HeaderProps) => {
    const historyFetcher = props.normal?.runAndHistoryProps?.viewHistoryProps?.historyFetcher
    const hasHistoryFetcher = typeof historyFetcher === 'function'

    return (
      <div
        data-testid='workflow-header'
        data-show-run={String(Boolean(props.normal?.runAndHistoryProps?.showRunButton))}
        data-show-preview={String(Boolean(props.normal?.runAndHistoryProps?.showPreviewButton))}
        data-history-url={props.normal?.runAndHistoryProps?.viewHistoryProps?.historyUrl ?? ''}
        data-has-history-fetcher={String(hasHistoryFetcher)}
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

vi.mock('@/service/workflow', () => ({
  __esModule: true,
  fetchWorkflowRunHistory: vi.fn(),
}))

vi.mock('@/service/use-workflow', () => ({
  __esModule: true,
  useResetWorkflowVersionHistory: () => mockResetWorkflowVersionHistory,
}))

describe('WorkflowHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appDetail = { id: 'app-id', mode: AppModeEnum.COMPLETION } as unknown as App

    mockUseAppStoreSelector.mockImplementation(selector => selector({
      appDetail,
      setCurrentLogItem: mockSetCurrentLogItem,
      setShowMessageLogModal: mockSetShowMessageLogModal,
    }))
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
      appDetail = { id: 'app-id', mode: AppModeEnum.ADVANCED_CHAT } as unknown as App
      mockUseAppStoreSelector.mockImplementation(selector => selector({
        appDetail,
        setCurrentLogItem: mockSetCurrentLogItem,
        setShowMessageLogModal: mockSetShowMessageLogModal,
      }))

      // Act
      render(<WorkflowHeader />)

      // Assert
      const header = screen.getByTestId('workflow-header')
      expect(header).toHaveAttribute('data-show-run', 'false')
      expect(header).toHaveAttribute('data-show-preview', 'true')
      expect(header).toHaveAttribute('data-history-url', '/apps/app-id/advanced-chat/workflow-runs')
      expect(header).toHaveAttribute('data-has-history-fetcher', 'true')
    })

    it('should configure run mode when app is not in advanced chat mode', () => {
      // Arrange
      appDetail = { id: 'app-id', mode: AppModeEnum.COMPLETION } as unknown as App
      mockUseAppStoreSelector.mockImplementation(selector => selector({
        appDetail,
        setCurrentLogItem: mockSetCurrentLogItem,
        setShowMessageLogModal: mockSetShowMessageLogModal,
      }))

      // Act
      render(<WorkflowHeader />)

      // Assert
      const header = screen.getByTestId('workflow-header')
      expect(header).toHaveAttribute('data-show-run', 'true')
      expect(header).toHaveAttribute('data-show-preview', 'false')
      expect(header).toHaveAttribute('data-history-url', '/apps/app-id/workflow-runs')
      expect(header).toHaveAttribute('data-has-history-fetcher', 'true')
    })
  })

  // Verifies callbacks clear log state as expected.
  describe('User Interactions', () => {
    it('should clear log and close message modal when clearing history modal state', () => {
      // Arrange
      render(<WorkflowHeader />)

      // Act
      screen.getByRole('button', { name: 'clear-history' }).click()

      // Assert
      expect(mockSetCurrentLogItem).toHaveBeenCalledWith()
      expect(mockSetShowMessageLogModal).toHaveBeenCalledWith(false)
    })
  })

  // Ensures restoring callback is wired to reset version history.
  describe('Edge Cases', () => {
    it('should use resetWorkflowVersionHistory as restore settled handler', () => {
      // Act
      render(<WorkflowHeader />)

      // Assert
      screen.getByRole('button', { name: 'restore-settled' }).click()
      expect(mockResetWorkflowVersionHistory).toHaveBeenCalled()
    })
  })
})
