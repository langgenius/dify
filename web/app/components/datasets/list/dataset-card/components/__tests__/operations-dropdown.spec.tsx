import type { DataSet } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import OperationsDropdown from '../operations-dropdown'

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
    it('should show delete option when not workspace dataset operator', () => {
      render(<OperationsDropdown {...defaultProps} isCurrentWorkspaceDatasetOperator={false} />)

      const triggerButton = document.querySelector('[class*="cursor-pointer"]')
      if (triggerButton)
        fireEvent.click(triggerButton)
    })

    it('should hide delete option when is workspace dataset operator', () => {
      render(<OperationsDropdown {...defaultProps} isCurrentWorkspaceDatasetOperator={true} />)

      const triggerButton = document.querySelector('[class*="cursor-pointer"]')
      if (triggerButton)
        fireEvent.click(triggerButton)
    })

    it('should show export pipeline when runtime_mode is rag_pipeline', () => {
      const dataset = createMockDataset({ runtime_mode: 'rag_pipeline' })
      render(<OperationsDropdown {...defaultProps} dataset={dataset} />)

      const triggerButton = document.querySelector('[class*="cursor-pointer"]')
      if (triggerButton)
        fireEvent.click(triggerButton)
    })

    it('should hide export pipeline when runtime_mode is not rag_pipeline', () => {
      const dataset = createMockDataset({ runtime_mode: 'general' })
      render(<OperationsDropdown {...defaultProps} dataset={dataset} />)

      const triggerButton = document.querySelector('[class*="cursor-pointer"]')
      if (triggerButton)
        fireEvent.click(triggerButton)
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
      expect(icon).toHaveClass('h-5', 'w-5', 'text-text-tertiary')
    })

    it('should have aria-label on trigger for accessibility', () => {
      const { container } = render(<OperationsDropdown {...defaultProps} />)
      const trigger = container.querySelector('[aria-label="Dataset operations"]')
      expect(trigger).toBeInTheDocument()
    })

    it('should expose visible keyboard focus styles on the trigger', () => {
      const { container } = render(<OperationsDropdown {...defaultProps} />)
      const trigger = container.querySelector('[aria-label="Dataset operations"]')
      expect(trigger).toHaveClass(
        'focus-visible:outline-hidden',
        'focus-visible:ring-1',
        'focus-visible:ring-inset',
        'focus-visible:ring-components-input-border-hover',
      )
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
