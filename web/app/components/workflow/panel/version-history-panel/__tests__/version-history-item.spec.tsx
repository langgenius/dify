import type { VersionHistory } from '@/types/workflow'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VersionHistoryContextMenuOptions, WorkflowVersion } from '../../../types'
import VersionHistoryItem from '../version-history-item'

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { pipelineId?: string }) => unknown) => selector({ pipelineId: undefined }),
}))

const createVersionHistory = (overrides: Partial<VersionHistory> = {}): VersionHistory => ({
  id: 'version-1',
  graph: {
    nodes: [],
    edges: [],
    viewport: undefined,
  },
  features: {},
  created_at: 1710000000,
  created_by: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
  },
  hash: 'hash-1',
  updated_at: 1710000000,
  updated_by: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
  },
  tool_published: false,
  environment_variables: [],
  conversation_variables: [],
  rag_pipeline_variables: undefined,
  version: '2024-01-01T00:00:00Z',
  marked_name: 'Release 1',
  marked_comment: 'Initial release',
  ...overrides,
})

describe('VersionHistoryItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Draft items should auto-select on mount and hide published-only metadata.
  describe('Draft Behavior', () => {
    it('should auto-select the draft version on mount', async () => {
      const onClick = vi.fn()

      render(
        <VersionHistoryItem
          item={createVersionHistory({
            id: 'draft-version',
            version: WorkflowVersion.Draft,
            marked_name: '',
            marked_comment: '',
          })}
          currentVersion={null}
          latestVersionId="latest-version"
          onClick={onClick}
          handleClickMenuItem={vi.fn()}
          isLast={false}
        />,
      )

      expect(screen.getByText('workflow.versionHistory.currentDraft')).toBeInTheDocument()

      await waitFor(() => {
        expect(onClick).toHaveBeenCalledWith(expect.objectContaining({
          version: WorkflowVersion.Draft,
        }))
      })

      expect(screen.queryByText('Initial release')).not.toBeInTheDocument()
    })
  })

  // Published items should expose metadata and the hover context menu.
  describe('Published Items', () => {
    it('should open the context menu for a latest named version and forward restore', async () => {
      const user = userEvent.setup()
      const handleClickMenuItem = vi.fn()
      const onClick = vi.fn()

      render(
        <VersionHistoryItem
          item={createVersionHistory()}
          currentVersion={null}
          latestVersionId="version-1"
          onClick={onClick}
          handleClickMenuItem={handleClickMenuItem}
          isLast={false}
        />,
      )

      const title = screen.getByText('Release 1')
      const itemContainer = title.closest('.group')
      if (!itemContainer)
        throw new Error('Expected version history item container')

      fireEvent.mouseEnter(itemContainer)

      const triggerButton = await screen.findByRole('button')
      await user.click(triggerButton)

      expect(screen.getByText('workflow.versionHistory.latest')).toBeInTheDocument()
      expect(screen.getByText('Initial release')).toBeInTheDocument()
      expect(screen.getByText(/Alice$/)).toBeInTheDocument()
      expect(screen.getByText('workflow.common.restore')).toBeInTheDocument()
      expect(screen.getByText('workflow.versionHistory.editVersionInfo')).toBeInTheDocument()
      expect(screen.getByText('app.export')).toBeInTheDocument()
      expect(screen.getByText('workflow.versionHistory.copyId')).toBeInTheDocument()
      expect(screen.queryByText('common.operation.delete')).not.toBeInTheDocument()

      const restoreItem = screen.getByText('workflow.common.restore').closest('.cursor-pointer')
      if (!restoreItem)
        throw new Error('Expected restore menu item')

      fireEvent.click(restoreItem)

      expect(handleClickMenuItem).toHaveBeenCalledTimes(1)
      expect(handleClickMenuItem).toHaveBeenCalledWith(
        VersionHistoryContextMenuOptions.restore,
        VersionHistoryContextMenuOptions.restore,
      )
    })

    it('should ignore clicks when the item is already selected', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()
      const item = createVersionHistory()

      render(
        <VersionHistoryItem
          item={item}
          currentVersion={item}
          latestVersionId="other-version"
          onClick={onClick}
          handleClickMenuItem={vi.fn()}
          isLast
        />,
      )

      await user.click(screen.getByText('Release 1'))

      expect(onClick).not.toHaveBeenCalled()
    })
  })
})
