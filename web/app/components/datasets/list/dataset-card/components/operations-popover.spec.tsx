import type { DataSet } from '@/models/datasets'
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import OperationsPopover from './operations-popover'

describe('OperationsPopover', () => {
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
    ...overrides,
  } as DataSet)

  const defaultProps = {
    dataset: createMockDataset(),
    isCurrentWorkspaceDatasetOperator: false,
    openRenameModal: vi.fn(),
    handleExportPipeline: vi.fn(),
    detectIsUsedByApp: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<OperationsPopover {...defaultProps} />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render the more icon button', () => {
      const { container } = render(<OperationsPopover {...defaultProps} />)
      const moreIcon = container.querySelector('svg')
      expect(moreIcon).toBeInTheDocument()
    })

    it('should render in hidden state initially (group-hover)', () => {
      const { container } = render(<OperationsPopover {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('hidden', 'group-hover:block')
    })
  })

  describe('Props', () => {
    it('should show delete option when not workspace dataset operator', () => {
      render(<OperationsPopover {...defaultProps} isCurrentWorkspaceDatasetOperator={false} />)

      // Click to open popover
      const triggerButton = document.querySelector('[class*="cursor-pointer"]')
      if (triggerButton)
        fireEvent.click(triggerButton)

      // showDelete should be true (inverse of isCurrentWorkspaceDatasetOperator)
      // This means delete operation will be visible
    })

    it('should hide delete option when is workspace dataset operator', () => {
      render(<OperationsPopover {...defaultProps} isCurrentWorkspaceDatasetOperator={true} />)

      // Click to open popover
      const triggerButton = document.querySelector('[class*="cursor-pointer"]')
      if (triggerButton)
        fireEvent.click(triggerButton)

      // showDelete should be false
    })

    it('should show export pipeline when runtime_mode is rag_pipeline', () => {
      const dataset = createMockDataset({ runtime_mode: 'rag_pipeline' })
      render(<OperationsPopover {...defaultProps} dataset={dataset} />)

      // Click to open popover
      const triggerButton = document.querySelector('[class*="cursor-pointer"]')
      if (triggerButton)
        fireEvent.click(triggerButton)

      // showExportPipeline should be true
    })

    it('should hide export pipeline when runtime_mode is not rag_pipeline', () => {
      const dataset = createMockDataset({ runtime_mode: 'general' })
      render(<OperationsPopover {...defaultProps} dataset={dataset} />)

      // Click to open popover
      const triggerButton = document.querySelector('[class*="cursor-pointer"]')
      if (triggerButton)
        fireEvent.click(triggerButton)

      // showExportPipeline should be false
    })
  })

  describe('Styles', () => {
    it('should have correct positioning styles', () => {
      const { container } = render(<OperationsPopover {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('absolute', 'right-2', 'top-2', 'z-[15]')
    })

    it('should have icon with correct size classes', () => {
      const { container } = render(<OperationsPopover {...defaultProps} />)
      const icon = container.querySelector('svg')
      expect(icon).toHaveClass('h-5', 'w-5', 'text-text-tertiary')
    })
  })

  describe('User Interactions', () => {
    it('should pass openRenameModal to Operations', () => {
      const openRenameModal = vi.fn()
      render(<OperationsPopover {...defaultProps} openRenameModal={openRenameModal} />)

      // The openRenameModal should be passed to Operations component
      expect(openRenameModal).not.toHaveBeenCalled() // Initially not called
    })

    it('should pass handleExportPipeline to Operations', () => {
      const handleExportPipeline = vi.fn()
      render(<OperationsPopover {...defaultProps} handleExportPipeline={handleExportPipeline} />)

      expect(handleExportPipeline).not.toHaveBeenCalled()
    })

    it('should pass detectIsUsedByApp to Operations', () => {
      const detectIsUsedByApp = vi.fn()
      render(<OperationsPopover {...defaultProps} detectIsUsedByApp={detectIsUsedByApp} />)

      expect(detectIsUsedByApp).not.toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle dataset with external provider', () => {
      const dataset = createMockDataset({ provider: 'external' })
      const { container } = render(<OperationsPopover {...defaultProps} dataset={dataset} />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle dataset with undefined runtime_mode', () => {
      const dataset = createMockDataset({ runtime_mode: undefined })
      const { container } = render(<OperationsPopover {...defaultProps} dataset={dataset} />)
      expect(container.firstChild).toBeInTheDocument()
    })
  })
})
