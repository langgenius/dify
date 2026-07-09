import type { DataSet } from '@/models/datasets'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { DatasetACLPermission } from '@/utils/permission'
import OperationsDropdown from '../operations-dropdown'

const mockAppContextState = vi.hoisted(() => ({
  userProfile: { id: 'user-1' },
  workspacePermissionKeys: [] as string[],
}))

let mockIsRbacEnabled = true

const render = (ui: Parameters<typeof renderWithSystemFeatures>[0]) => renderWithSystemFeatures(ui, {
  systemFeatures: {
    rbac_enabled: mockIsRbacEnabled,
  },
})

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } = await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(importOriginal, () => mockAppContextState, () => ({
    isRbacEnabled: mockIsRbacEnabled,
  }))
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } = await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(importOriginal, () => mockAppContextState, () => ({
    isRbacEnabled: mockIsRbacEnabled,
  }))
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } = await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(importOriginal, () => mockAppContextState, () => ({
    isRbacEnabled: mockIsRbacEnabled,
  }))
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } = await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(importOriginal, () => mockAppContextState, () => ({
    isRbacEnabled: mockIsRbacEnabled,
  }))
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } = await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(importOriginal, () => mockAppContextState, () => ({
    isRbacEnabled: mockIsRbacEnabled,
  }))
})

vi.mock('jotai', async (importOriginal) => {
  const { createDatasetAccessJotaiMock } = await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessJotaiMock(importOriginal)
})

describe('OperationsDropdown', () => {
  const createMockDataset = (overrides: Partial<DataSet> = {}): DataSet => ({
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
  } as DataSet)

  const defaultProps = {
    dataset: createMockDataset(),
    openRenameModal: vi.fn(),
    handleExportPipeline: vi.fn(),
    detectIsUsedByApp: vi.fn(),
    openAccessConfig: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockAppContextState.userProfile = { id: 'user-1' }
    mockAppContextState.workspacePermissionKeys = []
    mockIsRbacEnabled = true
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<OperationsDropdown {...defaultProps} />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render the more icon button', () => {
      const { container } = render(<OperationsDropdown {...defaultProps} />)
      const moreIcon = container.querySelector('.i-ri-more-fill')
      expect(moreIcon).toBeInTheDocument()
    })

    it('should render in hidden state initially (group-hover)', () => {
      const { container } = render(<OperationsDropdown {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass(
        'invisible',
        'pointer-events-none',
        'group-hover:visible',
        'group-hover:pointer-events-auto',
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

      expect(screen.queryByText('datasetPipeline.operations.exportPipeline')).not.toBeInTheDocument()
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
    it('should have correct positioning styles', () => {
      const { container } = render(<OperationsDropdown {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('absolute', 'right-2', 'top-2', 'z-5')
    })

    it('should keep the trigger mounted when closed so menu exit animations retain an anchor', () => {
      const { container } = render(<OperationsDropdown {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      const trigger = container.querySelector('[aria-label="Dataset operations"]')

      expect(wrapper).not.toHaveClass('hidden')
      expect(trigger).toBeInTheDocument()
    })

    it('should have icon with correct size classes', () => {
      const { container } = render(<OperationsDropdown {...defaultProps} />)
      const icon = container.querySelector('.i-ri-more-fill')
      expect(icon).toHaveClass('size-5', 'text-text-tertiary')
    })

    it('should have aria-label on trigger for accessibility', () => {
      const { container } = render(<OperationsDropdown {...defaultProps} />)
      const trigger = container.querySelector('[aria-label="Dataset operations"]')
      expect(trigger).toBeInTheDocument()
    })

    it('should use a solid trigger background without backdrop blur on hover states', () => {
      const { container } = render(<OperationsDropdown {...defaultProps} />)
      const trigger = container.querySelector('[aria-label="Dataset operations"]')
      expect(trigger).toHaveClass('bg-components-button-secondary-bg')
      expect(trigger).not.toHaveClass('hover:backdrop-blur-[5px]', 'backdrop-blur-[5px]')
    })
  })

  describe('User Interactions', () => {
    it('should keep outside interactions available when the menu is open', () => {
      const onOutsideClick = vi.fn()

      render(
        <div>
          <button type="button" onClick={onOutsideClick}>Outside action</button>
          <OperationsDropdown {...defaultProps} />
        </div>,
      )

      fireEvent.click(screen.getByLabelText('Dataset operations'))
      fireEvent.click(screen.getByRole('button', { name: 'Outside action' }))

      expect(onOutsideClick).toHaveBeenCalledTimes(1)
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
      render(<OperationsDropdown {...defaultProps} dataset={dataset} openAccessConfig={openAccessConfig} />)

      fireEvent.click(screen.getByLabelText('Dataset operations'))
      fireEvent.click(screen.getByText('common.settings.resourceAccess'))

      expect(openAccessConfig).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle dataset with external provider', () => {
      const dataset = createMockDataset({ provider: 'external' })
      const { container } = render(<OperationsDropdown {...defaultProps} dataset={dataset} />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle dataset with undefined runtime_mode', () => {
      const dataset = createMockDataset({ runtime_mode: undefined })
      const { container } = render(<OperationsDropdown {...defaultProps} dataset={dataset} />)
      expect(container.firstChild).toBeInTheDocument()
    })
  })
})
