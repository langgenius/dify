import type { WorkflowRunHistory, WorkflowRunHistoryResponse } from '@/types/workflow'
import { fireEvent, screen } from '@testing-library/react'
import * as React from 'react'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { ControlMode, WorkflowRunningStatus } from '../../types'
import ViewHistory from '../view-history'

const mockUseWorkflowRunHistory = vi.fn()
const mockFormatTimeFromNow = vi.fn((value: number) => `from-now:${value}`)
const mockCloseAllInputFieldPanels = vi.fn()
const mockHandleNodesCancelSelected = vi.fn()
const mockHandleCancelDebugAndPreviewPanel = vi.fn()
const mockFormatWorkflowRunIdentifier = vi.fn((finishedAt?: number, status?: string) => ` (${status || finishedAt || 'unknown'})`)

let mockIsChatMode = false

vi.mock('../../hooks', async () => {
  const actual = await vi.importActual<typeof import('../../hooks')>('../../hooks')
  return {
    ...actual,
    useIsChatMode: () => mockIsChatMode,
    useNodesInteractions: () => ({
      handleNodesCancelSelected: mockHandleNodesCancelSelected,
    }),
    useWorkflowInteractions: () => ({
      handleCancelDebugAndPreviewPanel: mockHandleCancelDebugAndPreviewPanel,
    }),
  }
})

vi.mock('@/service/use-workflow', () => ({
  useWorkflowRunHistory: (url?: string, enabled?: boolean) => mockUseWorkflowRunHistory(url, enabled),
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: mockFormatTimeFromNow,
  }),
}))

vi.mock('@/app/components/rag-pipeline/hooks', () => ({
  useInputFieldPanel: () => ({
    closeAllInputFieldPanels: mockCloseAllInputFieldPanels,
  }),
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="loading" />,
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/app/components/base/portal-to-follow-elem', () => {
  const PortalContext = React.createContext({ open: false })

  return {
    PortalToFollowElem: ({
      children,
      open,
    }: {
      children?: React.ReactNode
      open: boolean
    }) => <PortalContext.Provider value={{ open }}>{children}</PortalContext.Provider>,
    PortalToFollowElemTrigger: ({
      children,
      onClick,
    }: {
      children?: React.ReactNode
      onClick?: () => void
    }) => <div data-testid="portal-trigger" onClick={onClick}>{children}</div>,
    PortalToFollowElemContent: ({
      children,
    }: {
      children?: React.ReactNode
    }) => {
      const { open } = React.useContext(PortalContext)
      return open ? <div data-testid="portal-content">{children}</div> : null
    },
  }
})

vi.mock('../../utils', async () => {
  const actual = await vi.importActual<typeof import('../../utils')>('../../utils')
  return {
    ...actual,
    formatWorkflowRunIdentifier: (finishedAt?: number, status?: string) => mockFormatWorkflowRunIdentifier(finishedAt, status),
  }
})

const createHistoryItem = (overrides: Partial<WorkflowRunHistory> = {}): WorkflowRunHistory => ({
  id: 'run-1',
  version: 'v1',
  graph: {
    nodes: [],
    edges: [],
  },
  inputs: {},
  status: WorkflowRunningStatus.Succeeded,
  outputs: {},
  elapsed_time: 1,
  total_tokens: 2,
  total_steps: 3,
  created_at: 100,
  finished_at: 120,
  created_by_account: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
  },
  ...overrides,
})

describe('ViewHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsChatMode = false
    mockUseWorkflowRunHistory.mockReturnValue({
      data: { data: [] } satisfies WorkflowRunHistoryResponse,
      isLoading: false,
    })
  })

  it('defers fetching until the history popup is opened and renders the empty state', () => {
    renderWorkflowComponent(<ViewHistory historyUrl="/history" withText />, {
      hooksStoreProps: {
        handleBackupDraft: vi.fn(),
      },
    })

    expect(mockUseWorkflowRunHistory).toHaveBeenCalledWith('/history', false)
    expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.showRunHistory' }))

    expect(mockUseWorkflowRunHistory).toHaveBeenLastCalledWith('/history', true)
    expect(screen.getByText('workflow.common.notRunning')).toBeInTheDocument()
    expect(screen.getByText('workflow.common.showRunHistory')).toBeInTheDocument()
  })

  it('renders the icon trigger variant and loading state, and clears log modals on trigger click', () => {
    const onClearLogAndMessageModal = vi.fn()
    mockUseWorkflowRunHistory.mockReturnValue({
      data: { data: [] } satisfies WorkflowRunHistoryResponse,
      isLoading: true,
    })

    renderWorkflowComponent(
      <ViewHistory
        historyUrl="/history"
        onClearLogAndMessageModal={onClearLogAndMessageModal}
      />,
      {
        hooksStoreProps: {
          handleBackupDraft: vi.fn(),
        },
      },
    )

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.viewRunHistory' }))

    expect(onClearLogAndMessageModal).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders workflow run history items and updates the workflow store when one is selected', () => {
    const handleBackupDraft = vi.fn()
    const pausedRun = createHistoryItem({
      id: 'run-paused',
      status: WorkflowRunningStatus.Paused,
      created_at: 101,
      finished_at: 0,
    })
    const failedRun = createHistoryItem({
      id: 'run-failed',
      status: WorkflowRunningStatus.Failed,
      created_at: 102,
      finished_at: 130,
    })
    const succeededRun = createHistoryItem({
      id: 'run-succeeded',
      status: WorkflowRunningStatus.Succeeded,
      created_at: 103,
      finished_at: 140,
    })

    mockUseWorkflowRunHistory.mockReturnValue({
      data: {
        data: [pausedRun, failedRun, succeededRun],
      } satisfies WorkflowRunHistoryResponse,
      isLoading: false,
    })

    const { store } = renderWorkflowComponent(<ViewHistory historyUrl="/history" withText />, {
      initialStoreState: {
        historyWorkflowData: failedRun,
        showInputsPanel: true,
        showEnvPanel: true,
        controlMode: ControlMode.Pointer,
      },
      hooksStoreProps: {
        handleBackupDraft,
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.showRunHistory' }))

    expect(screen.getByText('Test Run (paused)')).toBeInTheDocument()
    expect(screen.getByText('Test Run (failed)')).toBeInTheDocument()
    expect(screen.getByText('Test Run (succeeded)')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Test Run (succeeded)'))

    expect(store.getState().historyWorkflowData).toEqual(succeededRun)
    expect(store.getState().showInputsPanel).toBe(false)
    expect(store.getState().showEnvPanel).toBe(false)
    expect(store.getState().controlMode).toBe(ControlMode.Hand)
    expect(mockCloseAllInputFieldPanels).toHaveBeenCalledTimes(1)
    expect(handleBackupDraft).toHaveBeenCalledTimes(1)
    expect(mockHandleNodesCancelSelected).toHaveBeenCalledTimes(1)
    expect(mockHandleCancelDebugAndPreviewPanel).toHaveBeenCalledTimes(1)
  })

  it('renders chat history labels without workflow status icons in chat mode', () => {
    mockIsChatMode = true
    const chatRun = createHistoryItem({
      id: 'chat-run',
      status: WorkflowRunningStatus.Failed,
    })

    mockUseWorkflowRunHistory.mockReturnValue({
      data: {
        data: [chatRun],
      } satisfies WorkflowRunHistoryResponse,
      isLoading: false,
    })

    renderWorkflowComponent(<ViewHistory historyUrl="/history" withText />, {
      hooksStoreProps: {
        handleBackupDraft: vi.fn(),
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.showRunHistory' }))

    expect(screen.getByText('Test Chat (failed)')).toBeInTheDocument()
  })

  it('closes the popup from the close button and clears log modals', () => {
    const onClearLogAndMessageModal = vi.fn()
    mockUseWorkflowRunHistory.mockReturnValue({
      data: { data: [] } satisfies WorkflowRunHistoryResponse,
      isLoading: false,
    })

    renderWorkflowComponent(
      <ViewHistory
        historyUrl="/history"
        withText
        onClearLogAndMessageModal={onClearLogAndMessageModal}
      />,
      {
        hooksStoreProps: {
          handleBackupDraft: vi.fn(),
        },
      },
    )

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.showRunHistory' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(onClearLogAndMessageModal).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()
  })
})
