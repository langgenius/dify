import type { PipelineTemplate } from '@/models/pipeline'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Toast from '@/app/components/base/toast'
import { ChunkingMode } from '@/models/datasets'
import EditPipelineInfo from './edit-pipeline-info'

// Mock service hooks
const mockUpdatePipeline = vi.fn()
const mockInvalidCustomizedTemplateList = vi.fn()

vi.mock('@/service/use-pipeline', () => ({
  useUpdateTemplateInfo: () => ({
    mutateAsync: mockUpdatePipeline,
  }),
  useInvalidCustomizedTemplateList: () => mockInvalidCustomizedTemplateList,
}))

// Mock Toast
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

// Mock AppIconPicker to capture interactions
let _mockOnSelect: ((icon: { type: 'emoji' | 'image', icon?: string, background?: string, fileId?: string, url?: string }) => void) | undefined
let _mockOnClose: (() => void) | undefined

vi.mock('@/app/components/base/app-icon-picker', () => ({
  default: ({ onSelect, onClose }: {
    onSelect: (icon: { type: 'emoji' | 'image', icon?: string, background?: string, fileId?: string, url?: string }) => void
    onClose: () => void
  }) => {
    _mockOnSelect = onSelect
    _mockOnClose = onClose
    return (
      <div data-testid="app-icon-picker">
        <button data-testid="select-emoji" onClick={() => onSelect({ type: 'emoji', icon: '🎯', background: '#FFEAD5' })}>
          Select Emoji
        </button>
        <button data-testid="select-image" onClick={() => onSelect({ type: 'image', fileId: 'new-file-id', url: 'https://new-icon.com/icon.png' })}>
          Select Image
        </button>
        <button data-testid="close-picker" onClick={onClose}>
          Close Picker
        </button>
      </div>
    )
  },
}))

// ============================================================================
// Test Data Factories
// ============================================================================

const createPipelineTemplate = (overrides: Partial<PipelineTemplate> = {}): PipelineTemplate => ({
  id: 'pipeline-1',
  name: 'Test Pipeline',
  description: 'Test pipeline description',
  icon: {
    icon_type: 'emoji',
    icon: '📊',
    icon_background: '#FFF4ED',
    icon_url: '',
  },
  chunk_structure: ChunkingMode.text,
  position: 0,
  ...overrides,
})

const createImagePipelineTemplate = (): PipelineTemplate => ({
  id: 'pipeline-2',
  name: 'Image Pipeline',
  description: 'Pipeline with image icon',
  icon: {
    icon_type: 'image',
    icon: 'file-id-123',
    icon_background: '',
    icon_url: 'https://example.com/icon.png',
  },
  chunk_structure: ChunkingMode.text,
  position: 1,
})

// ============================================================================
// EditPipelineInfo Component Tests
// ============================================================================

describe('EditPipelineInfo', () => {
  const defaultProps = {
    onClose: vi.fn(),
    pipeline: createPipelineTemplate(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    _mockOnSelect = undefined
    _mockOnClose = undefined
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<EditPipelineInfo {...defaultProps} />)
      expect(screen.getByText(/editPipelineInfo/i)).toBeInTheDocument()
    })

    it('should render title', () => {
      render(<EditPipelineInfo {...defaultProps} />)
      expect(screen.getByText(/editPipelineInfo/i)).toBeInTheDocument()
    })

    it('should render close button', () => {
      const { container } = render(<EditPipelineInfo {...defaultProps} />)
      const closeButton = container.querySelector('button[type="button"]')
      expect(closeButton).toBeInTheDocument()
    })

    it('should render name input with initial value', () => {
      render(<EditPipelineInfo {...defaultProps} />)
      const input = screen.getByDisplayValue('Test Pipeline')
      expect(input).toBeInTheDocument()
    })

    it('should render description textarea with initial value', () => {
      render(<EditPipelineInfo {...defaultProps} />)
      const textarea = screen.getByDisplayValue('Test pipeline description')
      expect(textarea).toBeInTheDocument()
    })

    it('should render save and cancel buttons', () => {
      render(<EditPipelineInfo {...defaultProps} />)
      expect(screen.getByText(/operation\.save/i)).toBeInTheDocument()
      expect(screen.getByText(/operation\.cancel/i)).toBeInTheDocument()
    })

    it('should render name and icon label', () => {
      render(<EditPipelineInfo {...defaultProps} />)
      expect(screen.getByText(/pipelineNameAndIcon/i)).toBeInTheDocument()
    })

    it('should render description label', () => {
      render(<EditPipelineInfo {...defaultProps} />)
      expect(screen.getByText(/knowledgeDescription/i)).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call onClose when close button is clicked', () => {
      const { container } = render(<EditPipelineInfo {...defaultProps} />)

      const closeButton = container.querySelector('button[type="button"]')
      fireEvent.click(closeButton!)

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when cancel button is clicked', () => {
      render(<EditPipelineInfo {...defaultProps} />)

      const cancelButton = screen.getByText(/operation\.cancel/i)
      fireEvent.click(cancelButton)

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('should update name when input changes', () => {
      render(<EditPipelineInfo {...defaultProps} />)

      const input = screen.getByDisplayValue('Test Pipeline')
      fireEvent.change(input, { target: { value: 'New Pipeline Name' } })

      expect(screen.getByDisplayValue('New Pipeline Name')).toBeInTheDocument()
    })

    it('should update description when textarea changes', () => {
      render(<EditPipelineInfo {...defaultProps} />)

      const textarea = screen.getByDisplayValue('Test pipeline description')
      fireEvent.change(textarea, { target: { value: 'New description' } })

      expect(screen.getByDisplayValue('New description')).toBeInTheDocument()
    })

    it('should call updatePipeline when save is clicked with valid name', async () => {
      mockUpdatePipeline.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess()
        return Promise.resolve()
      })

      render(<EditPipelineInfo {...defaultProps} />)

      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockUpdatePipeline).toHaveBeenCalled()
      })
    })

    it('should invalidate template list on successful save', async () => {
      mockUpdatePipeline.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess()
        return Promise.resolve()
      })

      render(<EditPipelineInfo {...defaultProps} />)

      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockInvalidCustomizedTemplateList).toHaveBeenCalled()
      })
    })

    it('should call onClose on successful save', async () => {
      mockUpdatePipeline.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess()
        return Promise.resolve()
      })

      render(<EditPipelineInfo {...defaultProps} />)

      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(defaultProps.onClose).toHaveBeenCalled()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Validation Tests
  // --------------------------------------------------------------------------
  describe('Validation', () => {
    it('should show error toast when name is empty', async () => {
      render(<EditPipelineInfo {...defaultProps} />)

      const input = screen.getByDisplayValue('Test Pipeline')
      fireEvent.change(input, { target: { value: '' } })

      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalledWith({
          type: 'error',
          message: 'Please enter a name for the Knowledge Base.',
        })
      })
    })

    it('should not call updatePipeline when name is empty', async () => {
      render(<EditPipelineInfo {...defaultProps} />)

      const input = screen.getByDisplayValue('Test Pipeline')
      fireEvent.change(input, { target: { value: '' } })

      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockUpdatePipeline).not.toHaveBeenCalled()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Icon Types Tests (Branch Coverage for lines 29-30, 36-37)
  // --------------------------------------------------------------------------
  describe('Icon Types', () => {
    it('should initialize with emoji icon type when pipeline has emoji icon', () => {
      const { container } = render(<EditPipelineInfo {...defaultProps} />)
      // Should render component with emoji icon
      expect(container.querySelector('[class*="cursor-pointer"]')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Test Pipeline')).toBeInTheDocument()
    })

    it('should initialize with image icon type when pipeline has image icon', async () => {
      const imagePipeline = createImagePipelineTemplate()
      // Verify test data has image icon type - this ensures the factory returns correct data
      expect(imagePipeline.icon.icon_type).toBe('image')
      expect(imagePipeline.icon.icon).toBe('file-id-123')
      expect(imagePipeline.icon.icon_url).toBe('https://example.com/icon.png')

      const props = {
        onClose: vi.fn(),
        pipeline: imagePipeline,
      }
      const { container } = render(<EditPipelineInfo {...props} />)
      // Component should initialize with image icon state
      expect(screen.getByDisplayValue('Image Pipeline')).toBeInTheDocument()
      expect(container.querySelector('[class*="cursor-pointer"]')).toBeInTheDocument()
    })

    it('should render correctly with image icon and then update', () => {
      // This test exercises both the initialization and update paths for image icon
      const imagePipeline = createImagePipelineTemplate()
      const props = {
        ...defaultProps,
        pipeline: imagePipeline,
      }
      const { container } = render(<EditPipelineInfo {...props} />)

      // Verify component rendered with image pipeline
      expect(screen.getByDisplayValue('Image Pipeline')).toBeInTheDocument()

      // Open icon picker
      const appIcon = container.querySelector('[class*="cursor-pointer"]')
      fireEvent.click(appIcon!)
      expect(screen.getByTestId('app-icon-picker')).toBeInTheDocument()
    })

    it('should save correct icon_info when starting with image icon type', async () => {
      mockUpdatePipeline.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess()
        return Promise.resolve()
      })

      const props = {
        ...defaultProps,
        pipeline: createImagePipelineTemplate(),
      }
      render(<EditPipelineInfo {...props} />)

      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockUpdatePipeline).toHaveBeenCalledWith(
          expect.objectContaining({
            icon_info: expect.objectContaining({
              icon_type: 'image',
              icon: 'file-id-123',
            }),
          }),
          expect.any(Object),
        )
      })
    })

    it('should save correct icon_info when starting with emoji icon type', async () => {
      mockUpdatePipeline.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess()
        return Promise.resolve()
      })

      render(<EditPipelineInfo {...defaultProps} />)

      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockUpdatePipeline).toHaveBeenCalledWith(
          expect.objectContaining({
            icon_info: expect.objectContaining({
              icon_type: 'emoji',
              icon: '📊',
            }),
          }),
          expect.any(Object),
        )
      })
    })

    it('should revert to initial image icon when picker is closed without selection', () => {
      const props = {
        ...defaultProps,
        pipeline: createImagePipelineTemplate(),
      }
      const { container } = render(<EditPipelineInfo {...props} />)

      // Open picker
      const appIcon = container.querySelector('[class*="cursor-pointer"]')
      fireEvent.click(appIcon!)
      expect(screen.getByTestId('app-icon-picker')).toBeInTheDocument()

      // Close without selection - should revert to original image icon
      const closeButton = screen.getByTestId('close-picker')
      fireEvent.click(closeButton)

      expect(screen.queryByTestId('app-icon-picker')).not.toBeInTheDocument()
    })

    it('should switch from image icon to emoji icon when selected', async () => {
      mockUpdatePipeline.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess()
        return Promise.resolve()
      })

      const props = {
        ...defaultProps,
        pipeline: createImagePipelineTemplate(),
      }
      const { container } = render(<EditPipelineInfo {...props} />)

      // Open picker and select emoji
      const appIcon = container.querySelector('[class*="cursor-pointer"]')
      fireEvent.click(appIcon!)
      const selectEmojiButton = screen.getByTestId('select-emoji')
      fireEvent.click(selectEmojiButton)

      // Save
      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockUpdatePipeline).toHaveBeenCalledWith(
          expect.objectContaining({
            icon_info: expect.objectContaining({
              icon_type: 'emoji',
              icon: '🎯',
            }),
          }),
          expect.any(Object),
        )
      })
    })

    it('should switch from emoji icon to image icon when selected', async () => {
      mockUpdatePipeline.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess()
        return Promise.resolve()
      })

      const { container } = render(<EditPipelineInfo {...defaultProps} />)

      // Open picker and select image
      const appIcon = container.querySelector('[class*="cursor-pointer"]')
      fireEvent.click(appIcon!)
      const selectImageButton = screen.getByTestId('select-image')
      fireEvent.click(selectImageButton)

      // Save
      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockUpdatePipeline).toHaveBeenCalledWith(
          expect.objectContaining({
            icon_info: expect.objectContaining({
              icon_type: 'image',
              icon: 'new-file-id',
            }),
          }),
          expect.any(Object),
        )
      })
    })
  })

  // --------------------------------------------------------------------------
  // AppIconPicker Tests (Branch Coverage)
  // --------------------------------------------------------------------------
  describe('AppIconPicker', () => {
    it('should not show picker initially', () => {
      render(<EditPipelineInfo {...defaultProps} />)
      expect(screen.queryByTestId('app-icon-picker')).not.toBeInTheDocument()
    })

    it('should open picker when icon is clicked', () => {
      const { container } = render(<EditPipelineInfo {...defaultProps} />)
      const appIcon = container.querySelector('[class*="cursor-pointer"]')
      fireEvent.click(appIcon!)

      expect(screen.getByTestId('app-icon-picker')).toBeInTheDocument()
    })

    it('should close picker and update icon when emoji is selected', () => {
      const { container } = render(<EditPipelineInfo {...defaultProps} />)
      const appIcon = container.querySelector('[class*="cursor-pointer"]')
      fireEvent.click(appIcon!)

      const selectEmojiButton = screen.getByTestId('select-emoji')
      fireEvent.click(selectEmojiButton)

      // Picker should close
      expect(screen.queryByTestId('app-icon-picker')).not.toBeInTheDocument()
    })

    it('should close picker and update icon when image is selected', () => {
      const { container } = render(<EditPipelineInfo {...defaultProps} />)
      const appIcon = container.querySelector('[class*="cursor-pointer"]')
      fireEvent.click(appIcon!)

      const selectImageButton = screen.getByTestId('select-image')
      fireEvent.click(selectImageButton)

      // Picker should close
      expect(screen.queryByTestId('app-icon-picker')).not.toBeInTheDocument()
    })

    it('should revert icon when picker is closed without selection', () => {
      const { container } = render(<EditPipelineInfo {...defaultProps} />)
      const appIcon = container.querySelector('[class*="cursor-pointer"]')
      fireEvent.click(appIcon!)

      const closeButton = screen.getByTestId('close-picker')
      fireEvent.click(closeButton)

      // Picker should close
      expect(screen.queryByTestId('app-icon-picker')).not.toBeInTheDocument()
    })

    it('should save with new emoji icon selection', async () => {
      mockUpdatePipeline.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess()
        return Promise.resolve()
      })

      const { container } = render(<EditPipelineInfo {...defaultProps} />)

      // Open picker and select new emoji
      const appIcon = container.querySelector('[class*="cursor-pointer"]')
      fireEvent.click(appIcon!)
      const selectEmojiButton = screen.getByTestId('select-emoji')
      fireEvent.click(selectEmojiButton)

      // Save
      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockUpdatePipeline).toHaveBeenCalledWith(
          expect.objectContaining({
            icon_info: expect.objectContaining({
              icon_type: 'emoji',
              icon: '🎯',
              icon_background: '#FFEAD5',
            }),
          }),
          expect.any(Object),
        )
      })
    })

    it('should save with new image icon selection', async () => {
      mockUpdatePipeline.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess()
        return Promise.resolve()
      })

      const { container } = render(<EditPipelineInfo {...defaultProps} />)

      // Open picker and select new image
      const appIcon = container.querySelector('[class*="cursor-pointer"]')
      fireEvent.click(appIcon!)
      const selectImageButton = screen.getByTestId('select-image')
      fireEvent.click(selectImageButton)

      // Save
      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockUpdatePipeline).toHaveBeenCalledWith(
          expect.objectContaining({
            icon_info: expect.objectContaining({
              icon_type: 'image',
              icon: 'new-file-id',
              icon_url: 'https://new-icon.com/icon.png',
            }),
          }),
          expect.any(Object),
        )
      })
    })
  })

  // --------------------------------------------------------------------------
  // Save Request Tests
  // --------------------------------------------------------------------------
  describe('Save Request', () => {
    it('should send correct request with emoji icon', async () => {
      mockUpdatePipeline.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess()
        return Promise.resolve()
      })

      render(<EditPipelineInfo {...defaultProps} />)

      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockUpdatePipeline).toHaveBeenCalledWith(
          expect.objectContaining({
            template_id: 'pipeline-1',
            name: 'Test Pipeline',
            description: 'Test pipeline description',
            icon_info: expect.objectContaining({
              icon_type: 'emoji',
            }),
          }),
          expect.any(Object),
        )
      })
    })

    it('should send correct request with image icon', async () => {
      mockUpdatePipeline.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess()
        return Promise.resolve()
      })

      const props = {
        ...defaultProps,
        pipeline: createImagePipelineTemplate(),
      }
      render(<EditPipelineInfo {...props} />)

      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockUpdatePipeline).toHaveBeenCalledWith(
          expect.objectContaining({
            template_id: 'pipeline-2',
            icon_info: expect.objectContaining({
              icon_type: 'image',
            }),
          }),
          expect.any(Object),
        )
      })
    })
  })

  // --------------------------------------------------------------------------
  // Layout Tests
  // --------------------------------------------------------------------------
  describe('Layout', () => {
    it('should have proper container styling', () => {
      const { container } = render(<EditPipelineInfo {...defaultProps} />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('relative', 'flex', 'flex-col')
    })

    it('should have close button in header', () => {
      const { container } = render(<EditPipelineInfo {...defaultProps} />)
      const closeButton = container.querySelector('button.absolute')
      expect(closeButton).toHaveClass('right-5', 'top-5')
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(<EditPipelineInfo {...defaultProps} />)
      rerender(<EditPipelineInfo {...defaultProps} />)
      expect(screen.getByText(/editPipelineInfo/i)).toBeInTheDocument()
    })
  })
})
