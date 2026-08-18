import type { KnowledgeFsUpgradeJobResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { DataSet } from '@/models/datasets'
import { createEvent, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { KNOWLEDGE_UPGRADE_RECOVERY_STORAGE_KEY } from '@/features/new-rag/storage'
import { KnowledgeUpgradeProvider } from '@/features/new-rag/upgrade/knowledge-upgrade-context'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { DatasetACLPermission } from '@/utils/permission'
import OperationsDropdown from '../operations-dropdown'

const mockConsoleState = vi.hoisted(() => ({
  userProfile: { id: 'user-1' },
  workspacePermissionKeys: [] as string[],
}))

let mockIsRbacEnabled = true
const noopKeyboardHandler = () => {}

const render = (ui: Parameters<typeof renderWithConsoleQuery>[0]) =>
  renderWithConsoleQuery(ui, {
    systemFeatures: {
      rbac_enabled: mockIsRbacEnabled,
    },
  })

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')

  return createWorkspaceStateModuleMock(() => mockConsoleState)
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => mockConsoleState)
})
describe('OperationsDropdown', () => {
  const createMockDataset = (overrides: Partial<DataSet> = {}): DataSet =>
    ({
      id: 'dataset-1',
      name: 'Test Dataset',
      description: 'Test description',
      provider: 'vendor',
      permission: DatasetPermission.allTeamMembers,
      data_source_type: DataSourceType.FILE,
      indexing_technique: IndexingType.QUALIFIED,
      embedding_available: true,
      app_count: 5,
      document_count: 10,
      word_count: 1000,
      updated_at: 1609545600,
      tags: [],
      embedding_model: 'text-embedding-ada-002',
      embedding_model_provider: 'openai',
      created_by: 'user-1',
      doc_form: ChunkingMode.text,
      runtime_mode: 'general',
      permission_keys: [
        DatasetACLPermission.Edit,
        DatasetACLPermission.Delete,
        DatasetACLPermission.ImportExportDSL,
        DatasetACLPermission.AccessConfig,
      ],
      ...overrides,
    }) as DataSet

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
    mockConsoleState.userProfile = { id: 'user-1' }
    mockConsoleState.workspacePermissionKeys = []
    mockIsRbacEnabled = true
  })

  describe('Rendering', () => {
    it('should render the more icon button', () => {
      const { container } = render(<OperationsDropdown {...defaultProps} />)
      const moreIcon = container.querySelector('.i-ri-more-fill')
      expect(moreIcon).toBeInTheDocument()
    })

    it('should reveal the initially transparent trigger on hover or keyboard focus', () => {
      const { container } = render(<OperationsDropdown {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass(
        'pointer-events-none',
        'opacity-0',
        'group-hover:pointer-events-auto',
        'group-hover:opacity-100',
        'focus-within:pointer-events-auto',
        'focus-within:opacity-100',
      )
    })
  })

  describe('Props', () => {
    it('should show delete option when dataset has delete ACL permission', () => {
      render(<OperationsDropdown {...defaultProps} />)

      fireEvent.click(screen.getByLabelText('Dataset operations'))

      expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
    })

    it('should hide delete option when dataset lacks delete ACL permission', () => {
      const dataset = createMockDataset({
        permission_keys: [DatasetACLPermission.Edit],
      })
      render(<OperationsDropdown {...defaultProps} dataset={dataset} />)

      fireEvent.click(screen.getByLabelText('Dataset operations'))

      expect(screen.queryByText('common.operation.delete')).not.toBeInTheDocument()
    })

    it('should show export pipeline when runtime_mode is rag_pipeline', () => {
      const dataset = createMockDataset({ runtime_mode: 'rag_pipeline' })
      render(<OperationsDropdown {...defaultProps} dataset={dataset} />)

      fireEvent.click(screen.getByLabelText('Dataset operations'))

      expect(screen.getByText('datasetPipeline.operations.exportPipeline')).toBeInTheDocument()
    })

    it('should hide export pipeline when runtime_mode is not rag_pipeline', () => {
      const dataset = createMockDataset({ runtime_mode: 'general' })
      render(<OperationsDropdown {...defaultProps} dataset={dataset} />)

      fireEvent.click(screen.getByLabelText('Dataset operations'))

      expect(
        screen.queryByText('datasetPipeline.operations.exportPipeline'),
      ).not.toBeInTheDocument()
    })

    it('should show resource access option when dataset has access config ACL permission', () => {
      const dataset = createMockDataset({
        permission_keys: [DatasetACLPermission.AccessConfig],
      })
      render(<OperationsDropdown {...defaultProps} dataset={dataset} />)

      fireEvent.click(screen.getByLabelText('Dataset operations'))

      expect(screen.getByText('common.settings.resourceAccess')).toBeInTheDocument()
    })

    it('should hide resource access option when RBAC is disabled', () => {
      mockIsRbacEnabled = false
      const dataset = createMockDataset({
        permission_keys: [DatasetACLPermission.AccessConfig, DatasetACLPermission.Delete],
      })
      render(<OperationsDropdown {...defaultProps} dataset={dataset} />)

      fireEvent.click(screen.getByLabelText('Dataset operations'))

      expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
      expect(screen.queryByText('common.settings.resourceAccess')).not.toBeInTheDocument()
    })
  })

  describe('Styles', () => {
    it('should keep the trigger mounted when closed so menu exit animations retain an anchor', () => {
      const { container } = render(<OperationsDropdown {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      const trigger = container.querySelector('[aria-label="Dataset operations"]')

      expect(wrapper).not.toHaveClass('hidden')
      expect(trigger).toBeInTheDocument()
    })

    it('should have aria-label on trigger for accessibility', () => {
      const { container } = render(<OperationsDropdown {...defaultProps} />)
      const trigger = container.querySelector('[aria-label="Dataset operations"]')
      expect(trigger).toBeInTheDocument()
    })

    it('should preserve the Figma menu width through the tour prop adapter', () => {
      render(<OperationsDropdown {...defaultProps} />)

      fireEvent.click(screen.getByLabelText('Dataset operations'))

      expect(screen.getByRole('menu')).toHaveClass('min-w-44')
    })

    it('should use a solid trigger background without backdrop blur on hover states', () => {
      const { container } = render(<OperationsDropdown {...defaultProps} />)
      const trigger = container.querySelector('[aria-label="Dataset operations"]')
      expect(trigger).toHaveClass('bg-components-button-secondary-bg')
      expect(trigger).not.toHaveClass('hover:backdrop-blur-[5px]', 'backdrop-blur-[5px]')
    })
  })

  describe('User Interactions', () => {
    it('exposes upgrade and its help as separate keyboard-addressable menu items', async () => {
      const user = userEvent.setup()

      render(
        <KnowledgeUpgradeProvider onUpgradeStarted={vi.fn()}>
          <OperationsDropdown {...defaultProps} />
        </KnowledgeUpgradeProvider>,
      )

      await user.click(screen.getByLabelText('Dataset operations'))

      const upgradeItem = await screen.findByRole('menuitem', {
        name: 'dataset.newKnowledge.upgrade.menuLabel',
      })
      const guideItem = screen.getByRole('menuitem', {
        name: 'dataset.newKnowledge.upgrade.guideTitle',
      })
      expect(upgradeItem).not.toContainElement(guideItem)

      await user.click(guideItem)
      expect(
        await screen.findByText('dataset.newKnowledge.upgrade.guideDescription'),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('menuitem', { name: 'dataset.newKnowledge.learnMore' }),
      ).toHaveAttribute('href', 'https://docs.dify.ai/en/guides/knowledge-base')
    })

    it('opens the knowledge upgrade confirmation from an editable legacy card', async () => {
      const user = userEvent.setup()

      render(
        <KnowledgeUpgradeProvider onUpgradeStarted={vi.fn()}>
          <OperationsDropdown {...defaultProps} />
        </KnowledgeUpgradeProvider>,
      )

      await user.click(screen.getByLabelText('Dataset operations'))
      await user.click(
        await screen.findByRole('menuitem', { name: 'dataset.newKnowledge.upgrade.menuLabel' }),
      )

      expect(
        await screen.findByRole('alertdialog', {
          name: 'dataset.newKnowledge.upgrade.dialogTitle',
        }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'dataset.newKnowledge.upgrade.start' }),
      ).toBeInTheDocument()
    })

    it('returns focus to dataset operations after cancelling the upgrade confirmation', async () => {
      const user = userEvent.setup()

      render(
        <KnowledgeUpgradeProvider onUpgradeStarted={vi.fn()}>
          <OperationsDropdown {...defaultProps} />
        </KnowledgeUpgradeProvider>,
      )

      const operationsTrigger = screen.getByLabelText('Dataset operations')
      await user.click(operationsTrigger)
      await user.click(
        await screen.findByRole('menuitem', { name: 'dataset.newKnowledge.upgrade.menuLabel' }),
      )
      await user.click(await screen.findByRole('button', { name: 'common.operation.cancel' }))

      await waitFor(() => expect(operationsTrigger).toHaveFocus())
    })

    it('does not offer another upgrade after a completed job is restored on refresh', async () => {
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
      localStorage.setItem(
        KNOWLEDGE_UPGRADE_RECOVERY_STORAGE_KEY,
        JSON.stringify({
          'workspace-1': [{ dataset: defaultProps.dataset, job: completedJob, notified: true }],
        }),
      )

      const user = userEvent.setup()
      render(
        <KnowledgeUpgradeProvider onUpgradeStarted={vi.fn()}>
          <OperationsDropdown {...defaultProps} />
        </KnowledgeUpgradeProvider>,
      )
      await user.click(screen.getByLabelText('Dataset operations'))

      expect(
        screen.queryByRole('menuitem', { name: 'dataset.newKnowledge.upgrade.menuLabel' }),
      ).not.toBeInTheDocument()
    })

    it('should keep outside interactions available when the menu is open', () => {
      const onOutsideClick = vi.fn()

      render(
        <div>
          <button type="button" onClick={onOutsideClick}>
            Outside action
          </button>
          <OperationsDropdown {...defaultProps} />
        </div>,
      )

      fireEvent.click(screen.getByLabelText('Dataset operations'))
      fireEvent.click(screen.getByRole('button', { name: 'Outside action' }))

      expect(onOutsideClick).toHaveBeenCalledTimes(1)
    })

    it('should prevent the card click default behavior when opening the menu', () => {
      render(<OperationsDropdown {...defaultProps} />)

      const trigger = screen.getByLabelText('Dataset operations')
      const event = createEvent.click(trigger)

      fireEvent(trigger, event)

      expect(event.defaultPrevented).toBe(true)
    })

    it('should keep menu item clicks from bubbling to the card while running the item action', async () => {
      const detectIsUsedByApp = vi.fn()
      const onCardClick = vi.fn()

      render(
        <div role="button" tabIndex={0} onClick={onCardClick} onKeyDown={noopKeyboardHandler}>
          <OperationsDropdown {...defaultProps} detectIsUsedByApp={detectIsUsedByApp} />
        </div>,
      )

      fireEvent.click(screen.getByLabelText('Dataset operations'))
      fireEvent.click(await screen.findByRole('menuitem', { name: 'common.operation.delete' }))

      expect(detectIsUsedByApp).toHaveBeenCalledTimes(1)
      expect(onCardClick).not.toHaveBeenCalled()
    })

    it('should keep the tour-opened operations menu open when its trigger is clicked', async () => {
      render(
        <OperationsDropdown
          {...defaultProps}
          stepByStepTourHighlightPart="knowledge-card-actions-menu"
          stepByStepTourOpen
        />,
      )

      expect(await screen.findByText('common.operation.edit')).toBeInTheDocument()

      fireEvent.click(screen.getByLabelText('Dataset operations'))

      expect(screen.getByText('common.operation.edit')).toBeInTheDocument()
      expect(screen.getByRole('menu', { hidden: true })).toHaveAttribute('aria-hidden', 'true')
      expect(screen.getByRole('menu', { hidden: true })).toHaveClass('pointer-events-none')
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

    it('should pass openRenameModal to Operations', () => {
      const openRenameModal = vi.fn()
      render(<OperationsDropdown {...defaultProps} openRenameModal={openRenameModal} />)
      expect(openRenameModal).not.toHaveBeenCalled()
    })

    it('should pass handleExportPipeline to Operations', () => {
      const handleExportPipeline = vi.fn()
      render(<OperationsDropdown {...defaultProps} handleExportPipeline={handleExportPipeline} />)
      expect(handleExportPipeline).not.toHaveBeenCalled()
    })

    it('should pass detectIsUsedByApp to Operations', () => {
      const detectIsUsedByApp = vi.fn()
      render(<OperationsDropdown {...defaultProps} detectIsUsedByApp={detectIsUsedByApp} />)
      expect(detectIsUsedByApp).not.toHaveBeenCalled()
    })

    it('should call openAccessConfig when resource access is clicked', () => {
      const openAccessConfig = vi.fn()
      const dataset = createMockDataset({
        permission_keys: [DatasetACLPermission.AccessConfig],
      })
      render(
        <OperationsDropdown
          {...defaultProps}
          dataset={dataset}
          openAccessConfig={openAccessConfig}
        />,
      )

      fireEvent.click(screen.getByLabelText('Dataset operations'))
      fireEvent.click(screen.getByText('common.settings.resourceAccess'))

      expect(openAccessConfig).toHaveBeenCalledTimes(1)
    })
  })
})
