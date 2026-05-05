import type { VersionHistory } from '@/types/workflow'
import { QueryClient } from '@tanstack/react-query'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { seedSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { FlowType } from '@/types/common'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { WorkflowVersion } from '../../types'
import HeaderInRestoring from '../header-in-restoring'

const mockRestoreWorkflow = vi.fn()
const mockInvalidAllLastRun = vi.fn()
const mockHandleLoadBackupDraft = vi.fn()
const mockHandleRefreshWorkflowDraft = vi.fn()
const mockRequestRestore = vi.fn()

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({
    theme: 'light',
  }),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: vi.fn(() => '09:30:00'),
  }),
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: vi.fn(() => '3 hours ago'),
  }),
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidAllLastRun: () => mockInvalidAllLastRun,
  useRestoreWorkflow: () => ({
    mutateAsync: mockRestoreWorkflow,
  }),
}))

vi.mock('../../hooks', () => ({
  useWorkflowRun: () => ({
    handleLoadBackupDraft: mockHandleLoadBackupDraft,
  }),
  useWorkflowRefreshDraft: () => ({
    handleRefreshWorkflowDraft: mockHandleRefreshWorkflowDraft,
  }),
  useLeaderRestore: () => ({
    requestRestore: mockRequestRestore,
  }),
}))

const createVersion = (overrides: Partial<VersionHistory> = {}): VersionHistory => ({
  id: 'version-1',
  graph: {
    nodes: [],
    edges: [],
  },
  created_at: 1_700_000_000,
  created_by: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
  },
  hash: 'hash-1',
  updated_at: 1_700_000_100,
  updated_by: {
    id: 'user-2',
    name: 'Bob',
    email: 'bob@example.com',
  },
  tool_published: false,
  version: 'v1',
  marked_name: 'Release 1',
  marked_comment: '',
  ...overrides,
})

const defaultConfigsMap = {
  flowId: 'app-1',
  flowType: FlowType.appFlow,
  fileSettings: {} as never,
}

describe('HeaderInRestoring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRestoreWorkflow.mockResolvedValue({})
  })

  it('should disable restore when the flow id is not ready yet', () => {
    renderWorkflowComponent(<HeaderInRestoring />, {
      initialStoreState: {
        currentVersion: createVersion(),
      },
      hooksStoreProps: {
        configsMap: undefined,
      },
    })

    expect(screen.getByRole('button', { name: 'workflow.common.restore' })).toBeDisabled()
  })

  it('should enable restore when version and flow config are both ready', () => {
    renderWorkflowComponent(<HeaderInRestoring />, {
      initialStoreState: {
        currentVersion: createVersion(),
      },
      hooksStoreProps: {
        configsMap: defaultConfigsMap,
      },
    })

    expect(screen.getByRole('button', { name: 'workflow.common.restore' })).toBeEnabled()
  })

  it('should keep restore disabled for draft versions even when flow config is ready', () => {
    renderWorkflowComponent(<HeaderInRestoring />, {
      initialStoreState: {
        currentVersion: createVersion({
          version: WorkflowVersion.Draft,
        }),
      },
      hooksStoreProps: {
        configsMap: defaultConfigsMap,
      },
    })

    expect(screen.getByRole('button', { name: 'workflow.common.restore' })).toBeDisabled()
  })

  describe('when collaboration mode is disabled (default)', () => {
    it('should call the REST API restore endpoint and refresh draft on success', async () => {
      const restoreVersionUrl = vi.fn((id: string) => `/apps/app-1/workflows/${id}/restore`)
      const onRestoreSettled = vi.fn()
      const deleteAllInspectVars = vi.fn()

      const { store } = renderWorkflowComponent(
        <HeaderInRestoring
          restoreVersionUrl={restoreVersionUrl}
          onRestoreSettled={onRestoreSettled}
        />,
        {
          initialStoreState: {
            isRestoring: true,
            showWorkflowVersionHistoryPanel: true,
            currentVersion: createVersion(),
            deleteAllInspectVars,
          },
          hooksStoreProps: { configsMap: defaultConfigsMap },
        },
      )

      fireEvent.click(screen.getByRole('button', { name: 'workflow.common.restore' }))

      await waitFor(() => {
        expect(restoreVersionUrl).toHaveBeenCalledWith('version-1')
        expect(mockRestoreWorkflow).toHaveBeenCalledWith('/apps/app-1/workflows/version-1/restore')
        expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalledTimes(1)
        expect(deleteAllInspectVars).toHaveBeenCalledTimes(1)
        expect(mockInvalidAllLastRun).toHaveBeenCalledTimes(1)
        expect(onRestoreSettled).toHaveBeenCalledTimes(1)
      })

      expect(store.getState().isRestoring).toBe(false)
      expect(store.getState().showWorkflowVersionHistoryPanel).toBe(false)
      expect(store.getState().backupDraft).toBeUndefined()
      // Must NOT use the CRDT path
      expect(mockRequestRestore).not.toHaveBeenCalled()
    })

    it('should call onRestoreSettled even when the REST API call fails', async () => {
      mockRestoreWorkflow.mockRejectedValue(new Error('network error'))
      const onRestoreSettled = vi.fn()

      renderWorkflowComponent(
        <HeaderInRestoring
          restoreVersionUrl={(id: string) => `/apps/app-1/workflows/${id}/restore`}
          onRestoreSettled={onRestoreSettled}
        />,
        {
          initialStoreState: {
            isRestoring: true,
            showWorkflowVersionHistoryPanel: true,
            currentVersion: createVersion(),
          },
          hooksStoreProps: { configsMap: defaultConfigsMap },
        },
      )

      fireEvent.click(screen.getByRole('button', { name: 'workflow.common.restore' }))

      await waitFor(() => {
        expect(onRestoreSettled).toHaveBeenCalledTimes(1)
        expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
      })
    })

    it('should fall back to the CRDT path when restoreVersionUrl is not provided', async () => {
      mockRequestRestore.mockImplementation((_payload: unknown, callbacks?: {
        onSuccess?: () => void
        onSettled?: () => void
      }) => {
        callbacks?.onSuccess?.()
        callbacks?.onSettled?.()
      })

      renderWorkflowComponent(
        // restoreVersionUrl intentionally omitted
        <HeaderInRestoring />,
        {
          initialStoreState: {
            isRestoring: true,
            currentVersion: createVersion(),
          },
          hooksStoreProps: { configsMap: defaultConfigsMap },
        },
      )

      fireEvent.click(screen.getByRole('button', { name: 'workflow.common.restore' }))

      await waitFor(() => {
        expect(mockRequestRestore).toHaveBeenCalledTimes(1)
        expect(mockRestoreWorkflow).not.toHaveBeenCalled()
      })
    })
  })

  describe('when collaboration mode is enabled', () => {
    const createCollabQueryClient = () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      seedSystemFeatures(queryClient, { enable_collaboration_mode: true })
      return queryClient
    }

    it('should use the CRDT path and not call the REST API', async () => {
      mockRequestRestore.mockImplementation((_payload: unknown, callbacks?: {
        onSuccess?: () => void
        onSettled?: () => void
      }) => {
        callbacks?.onSuccess?.()
        callbacks?.onSettled?.()
      })
      const restoreVersionUrl = vi.fn((id: string) => `/apps/app-1/workflows/${id}/restore`)
      const onRestoreSettled = vi.fn()

      renderWorkflowComponent(
        <HeaderInRestoring
          restoreVersionUrl={restoreVersionUrl}
          onRestoreSettled={onRestoreSettled}
        />,
        {
          queryClient: createCollabQueryClient(),
          initialStoreState: {
            isRestoring: true,
            currentVersion: createVersion(),
          },
          hooksStoreProps: { configsMap: defaultConfigsMap },
        },
      )

      fireEvent.click(screen.getByRole('button', { name: 'workflow.common.restore' }))

      await waitFor(() => {
        expect(mockRequestRestore).toHaveBeenCalledTimes(1)
        expect(mockRestoreWorkflow).not.toHaveBeenCalled()
        expect(onRestoreSettled).toHaveBeenCalledTimes(1)
      })
    })
  })
})
