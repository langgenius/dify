import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { DatasetACLPermission } from '@/utils/permission'
import OperationsDropdown from '../operations-dropdown'

let mockIsRbacEnabled = true

const render = (ui: Parameters<typeof renderWithConsoleQuery>[0]) =>
  renderWithConsoleQuery(ui, {
    accountProfile: { id: 'user-1' },
    workspacePermissionKeys: [],
    systemFeatures: {
      rbac_enabled: mockIsRbacEnabled,
    },
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
