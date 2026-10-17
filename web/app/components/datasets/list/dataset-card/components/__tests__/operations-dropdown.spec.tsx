import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { createEvent, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
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
  const createMockDataset = (
    overrides: Partial<DatasetDetailWithPartialMembersResponse> = {},
  ): DatasetDetailWithPartialMembersResponse => ({
    ...createDatasetFixture(),
    permission_keys: [
      DatasetACLPermission.Edit,
      DatasetACLPermission.Delete,
      DatasetACLPermission.ImportExportDSL,
      DatasetACLPermission.AccessConfig,
    ],
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
    mockConsoleState.userProfile = { id: 'user-1' }
    mockConsoleState.workspacePermissionKeys = []
    mockIsRbacEnabled = true
  })

  describe('Props', () => {
    it('should show delete option when dataset has delete ACL permission', async () => {
      const user = userEvent.setup()
      render(<OperationsDropdown {...defaultProps} />)

      await user.click(screen.getByLabelText('Dataset operations'))

      expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
    })

    it('should hide delete option when dataset lacks delete ACL permission', async () => {
      const user = userEvent.setup()
      const dataset = createMockDataset({
        permission_keys: [DatasetACLPermission.Edit],
      })
      render(<OperationsDropdown {...defaultProps} dataset={dataset} />)

      await user.click(screen.getByLabelText('Dataset operations'))

      expect(screen.queryByText('common.operation.delete')).not.toBeInTheDocument()
    })

    it('should show export pipeline when runtime_mode is rag_pipeline', async () => {
      const user = userEvent.setup()
      const dataset = createMockDataset({ runtime_mode: 'rag_pipeline' })
      render(<OperationsDropdown {...defaultProps} dataset={dataset} />)

      await user.click(screen.getByLabelText('Dataset operations'))

      expect(screen.getByText('datasetPipeline.operations.exportPipeline')).toBeInTheDocument()
    })

    it('should hide export pipeline when runtime_mode is not rag_pipeline', async () => {
      const user = userEvent.setup()
      const dataset = createMockDataset({ runtime_mode: 'general' })
      render(<OperationsDropdown {...defaultProps} dataset={dataset} />)

      await user.click(screen.getByLabelText('Dataset operations'))

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

      await user.click(screen.getByLabelText('Dataset operations'))

      expect(screen.getByText('navigation.settings.resourceAccess')).toBeInTheDocument()
    })

    it('should hide resource access option when RBAC is disabled', async () => {
      const user = userEvent.setup()
      mockIsRbacEnabled = false
      const dataset = createMockDataset({
        permission_keys: [DatasetACLPermission.AccessConfig, DatasetACLPermission.Delete],
      })
      render(<OperationsDropdown {...defaultProps} dataset={dataset} />)

      await user.click(screen.getByLabelText('Dataset operations'))

      expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
      expect(screen.queryByText('navigation.settings.resourceAccess')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
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

      await user.click(screen.getByLabelText('Dataset operations'))
      await user.click(screen.getByRole('button', { name: 'Outside action' }))

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
      const user = userEvent.setup()
      const detectIsUsedByApp = vi.fn()
      const onCardClick = vi.fn()

      render(
        <div role="button" tabIndex={0} onClick={onCardClick} onKeyDown={noopKeyboardHandler}>
          <OperationsDropdown {...defaultProps} detectIsUsedByApp={detectIsUsedByApp} />
        </div>,
      )

      await user.click(screen.getByLabelText('Dataset operations'))
      await user.click(await screen.findByRole('menuitem', { name: 'common.operation.delete' }))

      expect(detectIsUsedByApp).toHaveBeenCalledTimes(1)
      expect(onCardClick).not.toHaveBeenCalled()
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

    it('should call openAccessConfig when resource access is clicked', async () => {
      const user = userEvent.setup()
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

      await user.click(screen.getByLabelText('Dataset operations'))
      await user.click(screen.getByText('navigation.settings.resourceAccess'))

      expect(openAccessConfig).toHaveBeenCalledTimes(1)
    })
  })
})
