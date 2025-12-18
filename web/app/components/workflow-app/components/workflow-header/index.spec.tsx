import { render } from '@testing-library/react'
import type { App } from '@/types/app'
import { AppModeEnum } from '@/types/app'
import type { HeaderProps } from '@/app/components/workflow/header'
import WorkflowHeader from './index'
import { fetchWorkflowRunHistory } from '@/service/workflow'

const mockUseAppStoreSelector = jest.fn()
const mockSetCurrentLogItem = jest.fn()
const mockSetShowMessageLogModal = jest.fn()
const mockResetWorkflowVersionHistory = jest.fn()

let capturedHeaderProps: HeaderProps | null = null
let appDetail: App

jest.mock('ky', () => ({
  __esModule: true,
  default: {
    create: () => ({
      extend: () => async () => ({
        status: 200,
        headers: new Headers(),
        json: async () => ({}),
        blob: async () => new Blob(),
        clone: () => ({
          status: 200,
          json: async () => ({}),
        }),
      }),
    }),
  },
}))

jest.mock('@/app/components/app/store', () => ({
  __esModule: true,
  useStore: (selector: (state: { appDetail?: App; setCurrentLogItem: typeof mockSetCurrentLogItem; setShowMessageLogModal: typeof mockSetShowMessageLogModal }) => unknown) => mockUseAppStoreSelector(selector),
}))

jest.mock('@/app/components/workflow/header', () => ({
  __esModule: true,
  default: (props: HeaderProps) => {
    capturedHeaderProps = props
    return <div data-testid='workflow-header' />
  },
}))

jest.mock('@/service/workflow', () => ({
  __esModule: true,
  fetchWorkflowRunHistory: jest.fn(),
}))

jest.mock('@/service/use-workflow', () => ({
  __esModule: true,
  useResetWorkflowVersionHistory: () => mockResetWorkflowVersionHistory,
}))

describe('WorkflowHeader', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedHeaderProps = null
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
      expect(capturedHeaderProps).not.toBeNull()
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
      expect(capturedHeaderProps?.normal?.runAndHistoryProps?.showRunButton).toBe(false)
      expect(capturedHeaderProps?.normal?.runAndHistoryProps?.showPreviewButton).toBe(true)
      expect(capturedHeaderProps?.normal?.runAndHistoryProps?.viewHistoryProps?.historyUrl).toBe('/apps/app-id/advanced-chat/workflow-runs')
      expect(capturedHeaderProps?.normal?.runAndHistoryProps?.viewHistoryProps?.historyFetcher).toBe(fetchWorkflowRunHistory)
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
      expect(capturedHeaderProps?.normal?.runAndHistoryProps?.showRunButton).toBe(true)
      expect(capturedHeaderProps?.normal?.runAndHistoryProps?.showPreviewButton).toBe(false)
      expect(capturedHeaderProps?.normal?.runAndHistoryProps?.viewHistoryProps?.historyUrl).toBe('/apps/app-id/workflow-runs')
    })
  })

  // Verifies callbacks clear log state as expected.
  describe('User Interactions', () => {
    it('should clear log and close message modal when clearing history modal state', () => {
      // Arrange
      render(<WorkflowHeader />)

      const clear = capturedHeaderProps?.normal?.runAndHistoryProps?.viewHistoryProps?.onClearLogAndMessageModal
      expect(clear).toBeDefined()

      // Act
      clear?.()

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
      expect(capturedHeaderProps?.restoring?.onRestoreSettled).toBe(mockResetWorkflowVersionHistory)
    })
  })
})
