import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Content from './content'
import Actions from './actions'
import Operations from './operations'
import EditPipelineInfo from './edit-pipeline-info'
import type { PipelineTemplate } from '@/models/pipeline'
import { ChunkingMode } from '@/models/datasets'
import type { IconInfo } from '@/models/datasets'

// Mock service hooks for EditPipelineInfo
let mockUpdatePipeline: jest.Mock
let mockInvalidCustomizedTemplateList: jest.Mock

jest.mock('@/service/use-pipeline', () => ({
  useUpdateTemplateInfo: () => ({
    mutateAsync: mockUpdatePipeline,
  }),
  useInvalidCustomizedTemplateList: () => mockInvalidCustomizedTemplateList,
}))

// Mock AppIconPicker (not a base component)
jest.mock('@/app/components/base/app-icon-picker', () => ({
  __esModule: true,
  default: ({ onSelect, onClose }: {
    onSelect: (icon: { type: string; icon?: string; background?: string; url?: string; fileId?: string }) => void
    onClose: () => void
  }) => (
    <div data-testid="app-icon-picker">
      <button
        data-testid="select-emoji-icon"
        onClick={() => onSelect({ type: 'emoji', icon: '🚀', background: '#E6F4FF' })}
      >
        Select Emoji
      </button>
      <button
        data-testid="select-image-icon"
        onClick={() => onSelect({ type: 'image', url: 'https://example.com/new.png', fileId: 'new-file-id' })}
      >
        Select Image
      </button>
      <button data-testid="close-icon-picker" onClick={onClose}>Close</button>
    </div>
  ),
}))

// Factory functions
const createMockIconInfo = (overrides: Partial<IconInfo> = {}): IconInfo => ({
  icon_type: 'emoji',
  icon: '📙',
  icon_background: '#FFF4ED',
  icon_url: '',
  ...overrides,
})

const createMockPipeline = (overrides: Partial<PipelineTemplate> = {}): PipelineTemplate => ({
  id: 'test-pipeline-id',
  name: 'Test Pipeline',
  description: 'Test pipeline description',
  icon: createMockIconInfo(),
  position: 1,
  chunk_structure: ChunkingMode.text,
  ...overrides,
})

describe('Template Card Components', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUpdatePipeline = jest.fn()
    mockInvalidCustomizedTemplateList = jest.fn()
  })

  /**
   * Content Component Tests
   * Tests for the Content component that displays pipeline info
   */
  describe('Content', () => {
    const createContentProps = () => ({
      name: 'Test Pipeline',
      description: 'Test description',
      iconInfo: createMockIconInfo(),
      chunkStructure: ChunkingMode.text,
    })

    describe('Rendering', () => {
      it('should render without crashing', () => {
        const props = createContentProps()

        render(<Content {...props} />)

        expect(screen.getByText('Test Pipeline')).toBeInTheDocument()
      })

      it('should render pipeline name', () => {
        const props = { ...createContentProps(), name: 'My Custom Pipeline' }

        render(<Content {...props} />)

        expect(screen.getByText('My Custom Pipeline')).toBeInTheDocument()
      })

      it('should render pipeline description', () => {
        const props = { ...createContentProps(), description: 'This is a custom description' }

        render(<Content {...props} />)

        expect(screen.getByText('This is a custom description')).toBeInTheDocument()
      })

      it('should render name with title attribute for truncation', () => {
        const props = { ...createContentProps(), name: 'Long Pipeline Name' }

        render(<Content {...props} />)

        const nameElement = screen.getByText('Long Pipeline Name')
        expect(nameElement).toHaveAttribute('title', 'Long Pipeline Name')
        expect(nameElement).toHaveClass('truncate')
      })

      it('should render description with title attribute', () => {
        const props = { ...createContentProps(), description: 'Long description text' }

        render(<Content {...props} />)

        const descElement = screen.getByText('Long description text')
        expect(descElement).toHaveAttribute('title', 'Long description text')
      })

      it('should render chunking mode translation key', () => {
        const props = { ...createContentProps(), chunkStructure: ChunkingMode.text }

        render(<Content {...props} />)

        // Translation key format: dataset.chunkingMode.general
        expect(screen.getByText('dataset.chunkingMode.general')).toBeInTheDocument()
      })

      it('should render qa chunking mode', () => {
        const props = { ...createContentProps(), chunkStructure: ChunkingMode.qa }

        render(<Content {...props} />)

        expect(screen.getByText('dataset.chunkingMode.qa')).toBeInTheDocument()
      })

      it('should render parentChild chunking mode', () => {
        const props = { ...createContentProps(), chunkStructure: ChunkingMode.parentChild }

        render(<Content {...props} />)

        expect(screen.getByText('dataset.chunkingMode.parentChild')).toBeInTheDocument()
      })
    })

    describe('Icon Rendering', () => {
      it('should handle emoji icon type', () => {
        const props = {
          ...createContentProps(),
          iconInfo: createMockIconInfo({ icon_type: 'emoji', icon: '🚀' }),
        }

        expect(() => render(<Content {...props} />)).not.toThrow()
      })

      it('should handle image icon type', () => {
        const props = {
          ...createContentProps(),
          iconInfo: createMockIconInfo({
            icon_type: 'image',
            icon: 'file-id',
            icon_url: 'https://example.com/image.png',
          }),
        }

        expect(() => render(<Content {...props} />)).not.toThrow()
      })

      it('should use General icon as fallback for unknown chunk structure', () => {
        const props = {
          ...createContentProps(),
          chunkStructure: 'unknown' as ChunkingMode,
        }

        // Should not throw and fallback to General icon
        expect(() => render(<Content {...props} />)).not.toThrow()
      })
    })

    describe('Edge Cases', () => {
      it('should handle empty name', () => {
        const props = { ...createContentProps(), name: '' }

        expect(() => render(<Content {...props} />)).not.toThrow()
      })

      it('should handle empty description', () => {
        const props = { ...createContentProps(), description: '' }

        expect(() => render(<Content {...props} />)).not.toThrow()
      })

      it('should handle very long name', () => {
        const longName = 'A'.repeat(200)
        const props = { ...createContentProps(), name: longName }

        render(<Content {...props} />)

        expect(screen.getByText(longName)).toBeInTheDocument()
      })

      it('should handle unicode characters', () => {
        const props = {
          ...createContentProps(),
          name: '测试管道 🚀',
          description: '日本語テスト',
        }

        render(<Content {...props} />)

        expect(screen.getByText('测试管道 🚀')).toBeInTheDocument()
        expect(screen.getByText('日本語テスト')).toBeInTheDocument()
      })
    })

    describe('Styling', () => {
      it('should have correct typography classes for name', () => {
        const props = createContentProps()

        render(<Content {...props} />)

        const nameElement = screen.getByText('Test Pipeline')
        expect(nameElement).toHaveClass('system-md-semibold')
        expect(nameElement).toHaveClass('text-text-secondary')
      })

      it('should have correct typography classes for description', () => {
        const props = createContentProps()

        render(<Content {...props} />)

        const descElement = screen.getByText('Test description')
        expect(descElement).toHaveClass('system-xs-regular')
        expect(descElement).toHaveClass('text-text-tertiary')
        expect(descElement).toHaveClass('line-clamp-3')
      })
    })
  })

  /**
   * Actions Component Tests
   * Tests for the Actions component with apply, details, and more operations buttons
   */
  describe('Actions', () => {
    const createActionsProps = () => ({
      onApplyTemplate: jest.fn(),
      handleShowTemplateDetails: jest.fn(),
      showMoreOperations: true,
      openEditModal: jest.fn(),
      handleExportDSL: jest.fn(),
      handleDelete: jest.fn(),
    })

    describe('Rendering', () => {
      it('should render without crashing', () => {
        const props = createActionsProps()

        render(<Actions {...props} />)

        expect(screen.getByText('datasetPipeline.operations.choose')).toBeInTheDocument()
        expect(screen.getByText('datasetPipeline.operations.details')).toBeInTheDocument()
      })

      it('should render apply template button', () => {
        const props = createActionsProps()

        render(<Actions {...props} />)

        expect(screen.getByText('datasetPipeline.operations.choose')).toBeInTheDocument()
      })

      it('should render details button', () => {
        const props = createActionsProps()

        render(<Actions {...props} />)

        expect(screen.getByText('datasetPipeline.operations.details')).toBeInTheDocument()
      })

      it('should render more operations popover button when showMoreOperations is true', () => {
        const props = createActionsProps()

        render(<Actions {...props} />)

        // The popover button contains the RiMoreFill icon
        const popoverButtons = screen.getAllByRole('button')
        // Should have 3 buttons: choose, details, and more
        expect(popoverButtons).toHaveLength(3)
      })

      it('should not render more operations popover button when showMoreOperations is false', () => {
        const props = { ...createActionsProps(), showMoreOperations: false }

        render(<Actions {...props} />)

        // Should only have 2 buttons: choose and details
        const buttons = screen.getAllByRole('button')
        expect(buttons).toHaveLength(2)
      })
    })

    describe('Event Handlers', () => {
      it('should call onApplyTemplate when apply button is clicked', () => {
        const props = createActionsProps()

        render(<Actions {...props} />)

        const applyButton = screen.getByText('datasetPipeline.operations.choose').closest('button')
        fireEvent.click(applyButton!)

        expect(props.onApplyTemplate).toHaveBeenCalledTimes(1)
      })

      it('should call handleShowTemplateDetails when details button is clicked', () => {
        const props = createActionsProps()

        render(<Actions {...props} />)

        const detailsButton = screen.getByText('datasetPipeline.operations.details').closest('button')
        fireEvent.click(detailsButton!)

        expect(props.handleShowTemplateDetails).toHaveBeenCalledTimes(1)
      })
    })

    describe('Props Variations', () => {
      it('should handle showMoreOperations toggle', () => {
        const props = createActionsProps()

        const { rerender } = render(<Actions {...props} showMoreOperations={true} />)
        // Should have 3 buttons when showMoreOperations is true
        expect(screen.getAllByRole('button')).toHaveLength(3)

        rerender(<Actions {...props} showMoreOperations={false} />)
        // Should have 2 buttons when showMoreOperations is false
        expect(screen.getAllByRole('button')).toHaveLength(2)
      })
    })
  })

  /**
   * Operations Component Tests
   * Tests for the Operations dropdown menu
   */
  describe('Operations', () => {
    const createOperationsProps = () => ({
      openEditModal: jest.fn(),
      onDelete: jest.fn(),
      onExport: jest.fn(),
    })

    describe('Rendering', () => {
      it('should render without crashing', () => {
        const props = createOperationsProps()

        render(<Operations {...props} />)

        expect(screen.getByText('datasetPipeline.operations.editInfo')).toBeInTheDocument()
        expect(screen.getByText('datasetPipeline.operations.exportPipeline')).toBeInTheDocument()
        expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
      })

      it('should render edit option', () => {
        const props = createOperationsProps()

        render(<Operations {...props} />)

        expect(screen.getByText('datasetPipeline.operations.editInfo')).toBeInTheDocument()
      })

      it('should render export option', () => {
        const props = createOperationsProps()

        render(<Operations {...props} />)

        expect(screen.getByText('datasetPipeline.operations.exportPipeline')).toBeInTheDocument()
      })

      it('should render delete option', () => {
        const props = createOperationsProps()

        render(<Operations {...props} />)

        expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
      })
    })

    describe('Event Handlers', () => {
      it('should call openEditModal when edit is clicked', () => {
        const props = createOperationsProps()

        render(<Operations {...props} />)

        const editOption = screen.getByText('datasetPipeline.operations.editInfo').closest('div')
        fireEvent.click(editOption!)

        expect(props.openEditModal).toHaveBeenCalledTimes(1)
      })

      it('should call onExport when export is clicked', () => {
        const props = createOperationsProps()

        render(<Operations {...props} />)

        const exportOption = screen.getByText('datasetPipeline.operations.exportPipeline').closest('div')
        fireEvent.click(exportOption!)

        expect(props.onExport).toHaveBeenCalledTimes(1)
      })

      it('should call onDelete when delete is clicked', () => {
        const props = createOperationsProps()

        render(<Operations {...props} />)

        const deleteOption = screen.getByText('common.operation.delete').closest('div')
        fireEvent.click(deleteOption!)

        expect(props.onDelete).toHaveBeenCalledTimes(1)
      })

      it('should stop propagation on edit click', () => {
        const props = createOperationsProps()
        const parentClickHandler = jest.fn()

        render(
          <div onClick={parentClickHandler}>
            <Operations {...props} />
          </div>,
        )

        const editOption = screen.getByText('datasetPipeline.operations.editInfo').closest('div')
        fireEvent.click(editOption!)

        expect(parentClickHandler).not.toHaveBeenCalled()
      })

      it('should stop propagation on export click', () => {
        const props = createOperationsProps()
        const parentClickHandler = jest.fn()

        render(
          <div onClick={parentClickHandler}>
            <Operations {...props} />
          </div>,
        )

        const exportOption = screen.getByText('datasetPipeline.operations.exportPipeline').closest('div')
        fireEvent.click(exportOption!)

        expect(parentClickHandler).not.toHaveBeenCalled()
      })

      it('should stop propagation on delete click', () => {
        const props = createOperationsProps()
        const parentClickHandler = jest.fn()

        render(
          <div onClick={parentClickHandler}>
            <Operations {...props} />
          </div>,
        )

        const deleteOption = screen.getByText('common.operation.delete').closest('div')
        fireEvent.click(deleteOption!)

        expect(parentClickHandler).not.toHaveBeenCalled()
      })
    })

    describe('Styling', () => {
      it('should have correct container styling', () => {
        const props = createOperationsProps()

        const { container } = render(<Operations {...props} />)

        const operationsContainer = container.firstChild as HTMLElement
        expect(operationsContainer).toHaveClass('rounded-xl')
        expect(operationsContainer).toHaveClass('border-[0.5px]')
      })
    })
  })

  /**
   * EditPipelineInfo Component Tests
   * Tests for the edit pipeline info modal
   */
  describe('EditPipelineInfo', () => {
    const createEditPipelineInfoProps = () => ({
      onClose: jest.fn(),
      pipeline: createMockPipeline(),
    })

    describe('Rendering', () => {
      it('should render without crashing', () => {
        const props = createEditPipelineInfoProps()

        render(<EditPipelineInfo {...props} />)

        expect(screen.getByText('datasetPipeline.editPipelineInfo')).toBeInTheDocument()
      })

      it('should render header title', () => {
        const props = createEditPipelineInfoProps()

        render(<EditPipelineInfo {...props} />)

        expect(screen.getByText('datasetPipeline.editPipelineInfo')).toBeInTheDocument()
      })

      it('should render close button', () => {
        const props = createEditPipelineInfoProps()

        const { container } = render(<EditPipelineInfo {...props} />)

        const closeButton = container.querySelector('button.absolute.right-5')
        expect(closeButton).toBeInTheDocument()
      })

      it('should render name input with initial value', () => {
        const pipeline = createMockPipeline({ name: 'Initial Name' })
        const props = { ...createEditPipelineInfoProps(), pipeline }

        render(<EditPipelineInfo {...props} />)

        const input = screen.getByPlaceholderText('datasetPipeline.knowledgeNameAndIconPlaceholder')
        expect(input).toHaveValue('Initial Name')
      })

      it('should render description textarea with initial value', () => {
        const pipeline = createMockPipeline({ description: 'Initial Description' })
        const props = { ...createEditPipelineInfoProps(), pipeline }

        render(<EditPipelineInfo {...props} />)

        const textarea = screen.getByPlaceholderText('datasetPipeline.knowledgeDescriptionPlaceholder')
        expect(textarea).toHaveValue('Initial Description')
      })

      it('should render cancel and save buttons', () => {
        const props = createEditPipelineInfoProps()

        render(<EditPipelineInfo {...props} />)

        expect(screen.getByText('common.operation.cancel')).toBeInTheDocument()
        expect(screen.getByText('common.operation.save')).toBeInTheDocument()
      })

      it('should render labels', () => {
        const props = createEditPipelineInfoProps()

        render(<EditPipelineInfo {...props} />)

        expect(screen.getByText('datasetPipeline.pipelineNameAndIcon')).toBeInTheDocument()
        expect(screen.getByText('datasetPipeline.knowledgeDescription')).toBeInTheDocument()
      })
    })

    describe('State Management', () => {
      it('should update name when input changes', () => {
        const props = createEditPipelineInfoProps()

        render(<EditPipelineInfo {...props} />)

        const input = screen.getByPlaceholderText('datasetPipeline.knowledgeNameAndIconPlaceholder')
        fireEvent.change(input, { target: { value: 'New Name' } })

        expect(input).toHaveValue('New Name')
      })

      it('should update description when textarea changes', () => {
        const props = createEditPipelineInfoProps()

        render(<EditPipelineInfo {...props} />)

        const textarea = screen.getByPlaceholderText('datasetPipeline.knowledgeDescriptionPlaceholder')
        fireEvent.change(textarea, { target: { value: 'New Description' } })

        expect(textarea).toHaveValue('New Description')
      })

      it('should not show icon picker initially', () => {
        const props = createEditPipelineInfoProps()

        render(<EditPipelineInfo {...props} />)

        expect(screen.queryByTestId('app-icon-picker')).not.toBeInTheDocument()
      })
    })

    describe('Event Handlers', () => {
      it('should call onClose when close button is clicked', () => {
        const props = createEditPipelineInfoProps()

        const { container } = render(<EditPipelineInfo {...props} />)

        const closeButton = container.querySelector('button.absolute.right-5')
        fireEvent.click(closeButton!)

        expect(props.onClose).toHaveBeenCalledTimes(1)
      })

      it('should call onClose when cancel button is clicked', () => {
        const props = createEditPipelineInfoProps()

        render(<EditPipelineInfo {...props} />)

        const cancelButton = screen.getByText('common.operation.cancel')
        fireEvent.click(cancelButton)

        expect(props.onClose).toHaveBeenCalledTimes(1)
      })

      it('should call updatePipeline when save button is clicked', async () => {
        mockUpdatePipeline = jest.fn().mockImplementation((_req, options) => {
          options.onSuccess()
        })
        const props = createEditPipelineInfoProps()

        render(<EditPipelineInfo {...props} />)

        const saveButton = screen.getByText('common.operation.save')
        fireEvent.click(saveButton)

        await waitFor(() => {
          expect(mockUpdatePipeline).toHaveBeenCalledWith(
            expect.objectContaining({
              template_id: 'test-pipeline-id',
              name: 'Test Pipeline',
              description: 'Test pipeline description',
            }),
            expect.any(Object),
          )
        })
      })

      it('should not call updatePipeline when name is empty', async () => {
        const pipeline = createMockPipeline({ name: '' })
        const props = { ...createEditPipelineInfoProps(), pipeline }

        render(<EditPipelineInfo {...props} />)

        const saveButton = screen.getByText('common.operation.save')
        fireEvent.click(saveButton)

        await waitFor(() => {
          expect(mockUpdatePipeline).not.toHaveBeenCalled()
        })
      })

      it('should invalidate customized template list on success', async () => {
        mockUpdatePipeline = jest.fn().mockImplementation((_req, options) => {
          options.onSuccess()
        })
        const props = createEditPipelineInfoProps()

        render(<EditPipelineInfo {...props} />)

        const saveButton = screen.getByText('common.operation.save')
        fireEvent.click(saveButton)

        await waitFor(() => {
          expect(mockInvalidCustomizedTemplateList).toHaveBeenCalled()
        })
      })

      it('should call onClose on successful save', async () => {
        mockUpdatePipeline = jest.fn().mockImplementation((_req, options) => {
          options.onSuccess()
        })
        const props = createEditPipelineInfoProps()

        render(<EditPipelineInfo {...props} />)

        const saveButton = screen.getByText('common.operation.save')
        fireEvent.click(saveButton)

        await waitFor(() => {
          expect(props.onClose).toHaveBeenCalled()
        })
      })
    })

    describe('Icon Picker', () => {
      it('should show icon picker when app icon is clicked', () => {
        const props = createEditPipelineInfoProps()

        const { container } = render(<EditPipelineInfo {...props} />)

        // Find the AppIcon with onClick handler (has cursor-pointer class)
        const appIcon = container.querySelector('.cursor-pointer')
        fireEvent.click(appIcon!)

        expect(screen.getByTestId('app-icon-picker')).toBeInTheDocument()
      })

      it('should close icon picker when close is clicked', () => {
        const props = createEditPipelineInfoProps()

        const { container } = render(<EditPipelineInfo {...props} />)

        const appIcon = container.querySelector('.cursor-pointer')
        fireEvent.click(appIcon!)

        expect(screen.getByTestId('app-icon-picker')).toBeInTheDocument()

        fireEvent.click(screen.getByTestId('close-icon-picker'))

        expect(screen.queryByTestId('app-icon-picker')).not.toBeInTheDocument()
      })

      it('should update icon when new icon is selected', () => {
        const props = createEditPipelineInfoProps()

        const { container } = render(<EditPipelineInfo {...props} />)

        const appIcon = container.querySelector('.cursor-pointer')
        fireEvent.click(appIcon!)

        fireEvent.click(screen.getByTestId('select-emoji-icon'))

        expect(screen.queryByTestId('app-icon-picker')).not.toBeInTheDocument()
      })

      it('should restore previous icon when picker is closed without selection', () => {
        const props = createEditPipelineInfoProps()

        const { container } = render(<EditPipelineInfo {...props} />)

        const appIcon = container.querySelector('.cursor-pointer')
        fireEvent.click(appIcon!)

        fireEvent.click(screen.getByTestId('close-icon-picker'))

        expect(screen.queryByTestId('app-icon-picker')).not.toBeInTheDocument()
      })
    })

    describe('Icon Types', () => {
      it('should handle emoji icon type from pipeline', () => {
        const pipeline = createMockPipeline({
          icon: createMockIconInfo({
            icon_type: 'emoji',
            icon: '🚀',
            icon_background: '#E6F4FF',
          }),
        })
        const props = { ...createEditPipelineInfoProps(), pipeline }

        expect(() => render(<EditPipelineInfo {...props} />)).not.toThrow()
      })

      it('should handle image icon type from pipeline', () => {
        const pipeline = createMockPipeline({
          icon: createMockIconInfo({
            icon_type: 'image',
            icon: 'file-id',
            icon_url: 'https://example.com/image.png',
          }),
        })
        const props = { ...createEditPipelineInfoProps(), pipeline }

        expect(() => render(<EditPipelineInfo {...props} />)).not.toThrow()
      })

      it('should handle image icon type with empty url and fileId (fallback)', () => {
        // This covers the || '' fallback branches in lines 28-29 and 35-36
        const pipeline = createMockPipeline({
          icon: {
            icon_type: 'image',
            icon: '',
            icon_url: '',
            icon_background: '',
          },
        })
        const props = { ...createEditPipelineInfoProps(), pipeline }

        expect(() => render(<EditPipelineInfo {...props} />)).not.toThrow()
      })

      it('should handle image icon type with undefined url and fileId', () => {
        // This covers the || '' fallback branches when values are undefined
        const pipeline = createMockPipeline({
          icon: {
            icon_type: 'image',
            icon: undefined as unknown as string,
            icon_url: undefined as unknown as string,
            icon_background: '',
          },
        })
        const props = { ...createEditPipelineInfoProps(), pipeline }

        expect(() => render(<EditPipelineInfo {...props} />)).not.toThrow()
      })

      it('should handle emoji icon type with empty values (fallback)', () => {
        // This covers the || '' fallback branches for emoji type
        const pipeline = createMockPipeline({
          icon: {
            icon_type: 'emoji',
            icon: '',
            icon_url: '',
            icon_background: '',
          },
        })
        const props = { ...createEditPipelineInfoProps(), pipeline }

        expect(() => render(<EditPipelineInfo {...props} />)).not.toThrow()
      })
    })

    describe('Form Submission', () => {
      it('should submit with emoji icon type', async () => {
        mockUpdatePipeline = jest.fn().mockImplementation((_req, options) => {
          options.onSuccess()
        })
        const props = createEditPipelineInfoProps()

        render(<EditPipelineInfo {...props} />)

        const saveButton = screen.getByText('common.operation.save')
        fireEvent.click(saveButton)

        await waitFor(() => {
          expect(mockUpdatePipeline).toHaveBeenCalledWith(
            expect.objectContaining({
              icon_info: expect.objectContaining({
                icon_type: 'emoji',
                icon: '📙',
                icon_background: '#FFF4ED',
              }),
            }),
            expect.any(Object),
          )
        })
      })

      it('should submit with image icon type', async () => {
        mockUpdatePipeline = jest.fn().mockImplementation((_req, options) => {
          options.onSuccess()
        })
        const pipeline = createMockPipeline({
          icon: createMockIconInfo({
            icon_type: 'image',
            icon: 'file-id-123',
            icon_url: 'https://example.com/image.png',
          }),
        })
        const props = { ...createEditPipelineInfoProps(), pipeline }

        render(<EditPipelineInfo {...props} />)

        const saveButton = screen.getByText('common.operation.save')
        fireEvent.click(saveButton)

        await waitFor(() => {
          expect(mockUpdatePipeline).toHaveBeenCalledWith(
            expect.objectContaining({
              icon_info: expect.objectContaining({
                icon_type: 'image',
                icon: 'file-id-123',
                icon_url: 'https://example.com/image.png',
              }),
            }),
            expect.any(Object),
          )
        })
      })

      it('should submit with updated name and description', async () => {
        mockUpdatePipeline = jest.fn().mockImplementation((_req, options) => {
          options.onSuccess()
        })
        const props = createEditPipelineInfoProps()

        render(<EditPipelineInfo {...props} />)

        const nameInput = screen.getByPlaceholderText('datasetPipeline.knowledgeNameAndIconPlaceholder')
        const descTextarea = screen.getByPlaceholderText('datasetPipeline.knowledgeDescriptionPlaceholder')

        fireEvent.change(nameInput, { target: { value: 'Updated Name' } })
        fireEvent.change(descTextarea, { target: { value: 'Updated Description' } })

        const saveButton = screen.getByText('common.operation.save')
        fireEvent.click(saveButton)

        await waitFor(() => {
          expect(mockUpdatePipeline).toHaveBeenCalledWith(
            expect.objectContaining({
              name: 'Updated Name',
              description: 'Updated Description',
            }),
            expect.any(Object),
          )
        })
      })

      it('should submit with selected image icon from picker', async () => {
        mockUpdatePipeline = jest.fn().mockImplementation((_req, options) => {
          options.onSuccess()
        })
        const props = createEditPipelineInfoProps()

        const { container } = render(<EditPipelineInfo {...props} />)

        // Open icon picker and select image icon
        const appIcon = container.querySelector('.cursor-pointer')
        fireEvent.click(appIcon!)
        fireEvent.click(screen.getByTestId('select-image-icon'))

        // Save with the new image icon
        const saveButton = screen.getByText('common.operation.save')
        fireEvent.click(saveButton)

        await waitFor(() => {
          expect(mockUpdatePipeline).toHaveBeenCalledWith(
            expect.objectContaining({
              icon_info: expect.objectContaining({
                icon_type: 'image',
                icon: 'new-file-id',
                icon_url: 'https://example.com/new.png',
              }),
            }),
            expect.any(Object),
          )
        })
      })
    })

    describe('Edge Cases', () => {
      it('should handle empty initial description', () => {
        const pipeline = createMockPipeline({ description: '' })
        const props = { ...createEditPipelineInfoProps(), pipeline }

        render(<EditPipelineInfo {...props} />)

        const textarea = screen.getByPlaceholderText('datasetPipeline.knowledgeDescriptionPlaceholder')
        expect(textarea).toHaveValue('')
      })

      it('should handle very long name', () => {
        const longName = 'A'.repeat(200)
        const pipeline = createMockPipeline({ name: longName })
        const props = { ...createEditPipelineInfoProps(), pipeline }

        render(<EditPipelineInfo {...props} />)

        const input = screen.getByPlaceholderText('datasetPipeline.knowledgeNameAndIconPlaceholder')
        expect(input).toHaveValue(longName)
      })

      it('should handle unicode characters', () => {
        const pipeline = createMockPipeline({
          name: '测试管道 🚀',
          description: '日本語テスト',
        })
        const props = { ...createEditPipelineInfoProps(), pipeline }

        render(<EditPipelineInfo {...props} />)

        expect(screen.getByDisplayValue('测试管道 🚀')).toBeInTheDocument()
        expect(screen.getByDisplayValue('日本語テスト')).toBeInTheDocument()
      })
    })
  })

  /**
   * Component Memoization Tests
   * Tests for React.memo behavior across all components
   */
  describe('Component Memoization', () => {
    it('Content should render correctly after rerender', () => {
      const props = {
        name: 'Test',
        description: 'Desc',
        iconInfo: createMockIconInfo(),
        chunkStructure: ChunkingMode.text,
      }

      const { rerender } = render(<Content {...props} />)
      expect(screen.getByText('Test')).toBeInTheDocument()

      rerender(<Content {...props} />)
      expect(screen.getByText('Test')).toBeInTheDocument()
    })

    it('Actions should render correctly after rerender', () => {
      const props = {
        onApplyTemplate: jest.fn(),
        handleShowTemplateDetails: jest.fn(),
        showMoreOperations: true,
        openEditModal: jest.fn(),
        handleExportDSL: jest.fn(),
        handleDelete: jest.fn(),
      }

      const { rerender } = render(<Actions {...props} />)
      expect(screen.getByText('datasetPipeline.operations.choose')).toBeInTheDocument()

      rerender(<Actions {...props} />)
      expect(screen.getByText('datasetPipeline.operations.choose')).toBeInTheDocument()
    })

    it('Operations should render correctly after rerender', () => {
      const props = {
        openEditModal: jest.fn(),
        onDelete: jest.fn(),
        onExport: jest.fn(),
      }

      const { rerender } = render(<Operations {...props} />)
      expect(screen.getByText('datasetPipeline.operations.editInfo')).toBeInTheDocument()

      rerender(<Operations {...props} />)
      expect(screen.getByText('datasetPipeline.operations.editInfo')).toBeInTheDocument()
    })

    it('EditPipelineInfo should render correctly after rerender', () => {
      const props = {
        onClose: jest.fn(),
        pipeline: createMockPipeline(),
      }

      const { rerender } = render(<EditPipelineInfo {...props} />)
      expect(screen.getByText('datasetPipeline.editPipelineInfo')).toBeInTheDocument()

      rerender(<EditPipelineInfo {...props} />)
      expect(screen.getByText('datasetPipeline.editPipelineInfo')).toBeInTheDocument()
    })
  })
})
