import { fireEvent, render, screen } from '@testing-library/react'
import { WorkflowVersion } from '../../types'

const mockHandleRestoreFromPublishedWorkflow = vi.fn()
const mockHandleLoadBackupDraft = vi.fn()
const mockSetCurrentVersion = vi.fn()

vi.mock('@/context/app-context', () => ({
  useSelector: () => ({ id: 'test-user-id' }),
}))

vi.mock('@/service/use-workflow', () => ({
  useDeleteWorkflow: () => ({ mutateAsync: vi.fn() }),
  useInvalidAllLastRun: () => vi.fn(),
  useResetWorkflowVersionHistory: () => vi.fn(),
  useUpdateWorkflow: () => ({ mutateAsync: vi.fn() }),
  useWorkflowVersionHistory: () => ({
    data: {
      pages: [
        {
          items: [
            {
              id: 'draft-version-id',
              version: WorkflowVersion.Draft,
              graph: { nodes: [], edges: [], viewport: null },
              features: {
                opening_statement: '',
                suggested_questions: [],
                suggested_questions_after_answer: { enabled: false },
                text_to_speech: { enabled: false },
                speech_to_text: { enabled: false },
                retriever_resource: { enabled: false },
                sensitive_word_avoidance: { enabled: false },
                file_upload: { image: { enabled: false } },
              },
              created_at: Date.now() / 1000,
              created_by: { id: 'user-1', name: 'User 1' },
              environment_variables: [],
              marked_name: '',
              marked_comment: '',
            },
            {
              id: 'published-version-id',
              version: '2024-01-01T00:00:00Z',
              graph: { nodes: [], edges: [], viewport: null },
              features: {
                opening_statement: '',
                suggested_questions: [],
                suggested_questions_after_answer: { enabled: false },
                text_to_speech: { enabled: false },
                speech_to_text: { enabled: false },
                retriever_resource: { enabled: false },
                sensitive_word_avoidance: { enabled: false },
                file_upload: { image: { enabled: false } },
              },
              created_at: Date.now() / 1000,
              created_by: { id: 'user-1', name: 'User 1' },
              environment_variables: [],
              marked_name: 'v1.0',
              marked_comment: 'First release',
            },
          ],
        },
      ],
    },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetching: false,
  }),
}))

vi.mock('../../hooks', () => ({
  useDSL: () => ({ handleExportDSL: vi.fn() }),
  useNodesSyncDraft: () => ({ handleSyncWorkflowDraft: vi.fn() }),
  useWorkflowRun: () => ({
    handleRestoreFromPublishedWorkflow: mockHandleRestoreFromPublishedWorkflow,
    handleLoadBackupDraft: mockHandleLoadBackupDraft,
  }),
}))

vi.mock('../../hooks-store', () => ({
  useHooksStore: () => ({
    flowId: 'test-flow-id',
    flowType: 'workflow',
  }),
}))

vi.mock('../../store', () => ({
  useStore: (selector: (state: any) => any) => {
    const state = {
      setShowWorkflowVersionHistoryPanel: vi.fn(),
      currentVersion: null,
      setCurrentVersion: mockSetCurrentVersion,
    }
    return selector(state)
  },
  useWorkflowStore: () => ({
    getState: () => ({
      deleteAllInspectVars: vi.fn(),
      setShowWorkflowVersionHistoryPanel: vi.fn(),
      setCurrentVersion: mockSetCurrentVersion,
    }),
    setState: vi.fn(),
  }),
}))

vi.mock('./delete-confirm-modal', () => ({
  default: () => null,
}))

vi.mock('./restore-confirm-modal', () => ({
  default: () => null,
}))

vi.mock('@/app/components/app/app-publisher/version-info-modal', () => ({
  default: () => null,
}))

describe('VersionHistoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Version Click Behavior', () => {
    it('should call handleLoadBackupDraft when draft version is selected on mount', async () => {
      const { VersionHistoryPanel } = await import('./index')

      render(
        <VersionHistoryPanel
          latestVersionId="published-version-id"
        />,
      )

      // Draft version auto-clicks on mount via useEffect in VersionHistoryItem
      expect(mockHandleLoadBackupDraft).toHaveBeenCalled()
      expect(mockHandleRestoreFromPublishedWorkflow).not.toHaveBeenCalled()
    })

    it('should call handleRestoreFromPublishedWorkflow when clicking published version', async () => {
      const { VersionHistoryPanel } = await import('./index')

      render(
        <VersionHistoryPanel
          latestVersionId="published-version-id"
        />,
      )

      // Clear mocks after initial render (draft version auto-clicks on mount)
      vi.clearAllMocks()

      const publishedItem = screen.getByText('v1.0')
      fireEvent.click(publishedItem)

      expect(mockHandleRestoreFromPublishedWorkflow).toHaveBeenCalled()
      expect(mockHandleLoadBackupDraft).not.toHaveBeenCalled()
    })
  })
})
