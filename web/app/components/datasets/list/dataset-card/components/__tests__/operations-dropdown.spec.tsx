import type {
  DatasetListItemResponse,
  KnowledgeFsUpgradeJobResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { KnowledgeUpgradeProvider } from '@/features/new-rag/upgrade/knowledge-upgrade-context'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { DatasetACLPermission } from '@/utils/permission'
import OperationsDropdown from '../operations-dropdown'

let mockIsRbacEnabled = true

const render = (ui: Parameters<typeof renderWithConsoleQuery>[0]) => {
  const queryClient = createConsoleQueryClient()
  const discoveryOptions = consoleQuery.datasets.byDatasetId.knowledgeFsUpgrades.get.queryOptions({
    input: { params: { dataset_id: 'dataset-1' } },
  })
  queryClient.setQueryDefaults(discoveryOptions.queryKey, { staleTime: Infinity })
  queryClient.setQueryData(discoveryOptions.queryKey, {
    can_retry: false,
    can_upgrade: true,
    job: null,
  })

  return renderWithConsoleQuery(ui, {
    queryClient,
    accountProfile: { id: 'user-1' },
    workspacePermissionKeys: [],
    systemFeatures: {
      rbac_enabled: mockIsRbacEnabled,
    },
  })
}

describe('OperationsDropdown', () => {
  const createMockDataset = (
    overrides: Partial<DatasetListItemResponse> = {},
  ): DatasetListItemResponse => ({
    ...createDatasetFixture(),
    permission_keys: [
      DatasetACLPermission.Edit,
      DatasetACLPermission.Delete,
      DatasetACLPermission.ImportExportDSL,
      DatasetACLPermission.AccessConfig,
    ],
    knowledge_fs_upgrade: {
      can_retry: false,
      can_upgrade: true,
      job: null,
    },
    ...overrides,
  })

  const defaultProps = {
    dataset: createMockDataset(),
    openRenameModal: vi.fn(),
    handleExportPipeline: vi.fn(),
    detectIsUsedByApp: vi.fn(),
    openAccessConfig: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockIsRbacEnabled = true
  })

  describe('Props', () => {
    it('should show delete option when dataset has delete ACL permission', async () => {
      const user = userEvent.setup()
      render(<OperationsDropdown {...defaultProps} />)

      await user.click(screen.getByLabelText('common.operation.more'))

      expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
    })

    it('should hide delete option when dataset lacks delete ACL permission', async () => {
      const user = userEvent.setup()
      const dataset = createMockDataset({
        permission_keys: [DatasetACLPermission.Edit],
      })
      render(<OperationsDropdown {...defaultProps} dataset={dataset} />)

      await user.click(screen.getByLabelText('common.operation.more'))

      expect(screen.queryByText('common.operation.delete')).not.toBeInTheDocument()
    })

    it('should show export pipeline when runtime_mode is rag_pipeline', async () => {
      const user = userEvent.setup()
      const dataset = createMockDataset({ runtime_mode: 'rag_pipeline' })
      render(<OperationsDropdown {...defaultProps} dataset={dataset} />)

      await user.click(screen.getByLabelText('common.operation.more'))

      expect(screen.getByText('datasetPipeline.operations.exportPipeline')).toBeInTheDocument()
    })

    it('should hide export pipeline when runtime_mode is not rag_pipeline', async () => {
      const user = userEvent.setup()
      const dataset = createMockDataset({ runtime_mode: 'general' })
      render(<OperationsDropdown {...defaultProps} dataset={dataset} />)

      await user.click(screen.getByLabelText('common.operation.more'))

      expect(
        screen.queryByText('datasetPipeline.operations.exportPipeline'),
      ).not.toBeInTheDocument()
    })

    it('should show resource access option when dataset has access config ACL permission', async () => {
      const user = userEvent.setup()
      const dataset = createMockDataset({
        permission_keys: [DatasetACLPermission.AccessConfig],
      })
      render(<OperationsDropdown {...defaultProps} dataset={dataset} />)

      await user.click(screen.getByLabelText('common.operation.more'))

      expect(screen.getByText('navigation.settings.resourceAccess')).toBeInTheDocument()
    })

    it('should hide resource access option when RBAC is disabled', async () => {
      const user = userEvent.setup()
      mockIsRbacEnabled = false
      const dataset = createMockDataset({
        permission_keys: [DatasetACLPermission.AccessConfig, DatasetACLPermission.Delete],
      })
      render(<OperationsDropdown {...defaultProps} dataset={dataset} />)

      await user.click(screen.getByLabelText('common.operation.more'))

      expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
      expect(screen.queryByText('navigation.settings.resourceAccess')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('opens the knowledge upgrade confirmation from an editable legacy card', async () => {
      const user = userEvent.setup()

      render(
        <KnowledgeUpgradeProvider onUpgradeStarted={vi.fn()}>
          <OperationsDropdown {...defaultProps} />
        </KnowledgeUpgradeProvider>,
      )

      await user.click(screen.getByLabelText('common.operation.more'))
      const upgradeItem = await screen.findByRole('menuitem', {
        name: 'knowledgeUpgrade.upgrade.menuLabel',
      })
      expect(upgradeItem).not.toHaveAttribute('aria-haspopup')
      expect(screen.getAllByRole('menu')).toHaveLength(1)
      expect(
        screen.queryByRole('menuitem', {
          name: 'knowledgeUpgrade.upgrade.guideTitle',
        }),
      ).not.toBeInTheDocument()
      await user.click(upgradeItem)

      expect(
        await screen.findByRole('alertdialog', {
          name: 'knowledgeUpgrade.upgrade.dialogTitle',
        }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'knowledgeUpgrade.upgrade.start' }),
      ).toBeInTheDocument()
    })

    it('returns focus to dataset operations after cancelling the upgrade confirmation', async () => {
      const user = userEvent.setup()

      render(
        <KnowledgeUpgradeProvider onUpgradeStarted={vi.fn()}>
          <OperationsDropdown {...defaultProps} />
        </KnowledgeUpgradeProvider>,
      )

      const operationsTrigger = screen.getByLabelText('common.operation.more')
      await user.click(operationsTrigger)
      await user.click(
        await screen.findByRole('menuitem', { name: 'knowledgeUpgrade.upgrade.menuLabel' }),
      )
      await user.click(await screen.findByRole('button', { name: 'common.operation.cancel' }))

      await waitFor(() => expect(operationsTrigger).toHaveFocus())
    })

    it('does not offer another upgrade when the dataset summary reports completion', async () => {
      const completedJob: KnowledgeFsUpgradeJobResponse = {
        completed_documents: 10,
        completed_sources: 1,
        id: 'upgrade-1',
        new_control_space_id: 'space-1',
        old_dataset_id: defaultProps.dataset.id,
        snapshot_at: '2026-08-18T00:00:00Z',
        stage: 'completed',
        status: 'succeeded',
        total_documents: 10,
        total_sources: 1,
      }
      const user = userEvent.setup()
      render(
        <KnowledgeUpgradeProvider onUpgradeStarted={vi.fn()}>
          <OperationsDropdown
            {...defaultProps}
            dataset={createMockDataset({
              knowledge_fs_upgrade: {
                block_reason: 'already_upgraded',
                can_retry: false,
                can_upgrade: false,
                job: completedJob,
              },
            })}
          />
        </KnowledgeUpgradeProvider>,
      )
      await user.click(screen.getByLabelText('common.operation.more'))

      expect(
        screen.queryByRole('menuitem', { name: 'knowledgeUpgrade.upgrade.menuLabel' }),
      ).not.toBeInTheDocument()
    })

    it('should keep outside interactions available when the menu is open', async () => {
      const user = userEvent.setup()
      const onOutsideClick = vi.fn()

      render(
        <div>
          <button type="button" onClick={onOutsideClick}>
            Outside action
          </button>
          <OperationsDropdown {...defaultProps} />
        </div>,
      )

      await user.click(screen.getByLabelText('common.operation.more'))
      await user.click(screen.getByRole('button', { name: 'Outside action' }))

      expect(onOutsideClick).toHaveBeenCalledTimes(1)
    })

    it('should keep tour-opened operations menu items from running actions', async () => {
      const detectIsUsedByApp = vi.fn()

      render(
        <OperationsDropdown
          {...defaultProps}
          detectIsUsedByApp={detectIsUsedByApp}
          stepByStepTourHighlightPart="knowledge-card-actions-menu"
          stepByStepTourOpen
        />,
      )

      fireEvent.click(
        await screen.findByRole('menuitem', { name: 'common.operation.delete', hidden: true }),
      )

      expect(detectIsUsedByApp).not.toHaveBeenCalled()
      expect(screen.getByRole('menu', { hidden: true })).toBeInTheDocument()
    })
  })
})
