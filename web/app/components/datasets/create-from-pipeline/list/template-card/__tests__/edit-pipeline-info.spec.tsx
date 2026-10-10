import type { ReactElement } from 'react'
import type { PipelineTemplate } from '@/models/pipeline'
import { useMutation } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ChunkingMode } from '@/models/datasets'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { mockEmojiData, renderWithEmoji as testingLibraryRender } from '@/test/emoji-picker'
import { EditPipelineInfo } from '../edit-pipeline-info'

const render = (ui: ReactElement) =>
  testingLibraryRender(ui, { wrapper: createConsoleQueryWrapper().wrapper })

const mockUpdatePipeline = vi.fn()
const mockInvalidCustomizedTemplateList = vi.fn()

vi.mock('@/service/use-pipeline', () => ({
  useUpdateTemplateInfo: () =>
    useMutation({
      mutationFn: (request: unknown) => mockUpdatePipeline(request, { onSuccess: () => {} }),
    }),
  useInvalidCustomizedTemplateList: () => mockInvalidCustomizedTemplateList,
}))

const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}))

vi.mock('@/app/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/notifications')>()
  return {
    ...actual,
    toast: {
      ...actual.toast,
      error: mockToastError,
    },
  }
})

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

// EditPipelineInfo Component Tests

describe('EditPipelineInfo', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    pipeline: createPipelineTemplate(),
  }
  const getIconButton = () =>
    screen.getByRole('button', {
      name: 'common.operation.edit datasetPipeline.pipelineNameAndIcon',
    })

  beforeEach(() => {
    vi.clearAllMocks()
    mockToastError.mockReset()
    mockUpdatePipeline.mockReset()
    mockInvalidCustomizedTemplateList.mockReset()
  })

  describe('Rendering', () => {
    it('should render title', () => {
      render(<EditPipelineInfo {...defaultProps} />)
      expect(screen.getByRole('dialog', { name: /editPipelineInfo/i })).toBeInTheDocument()
    })

    it('should render close button', () => {
      render(<EditPipelineInfo {...defaultProps} />)
      expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeInTheDocument()
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

  describe('User Interactions', () => {
    it('should call onOpenChange when close button is clicked', async () => {
      const user = userEvent.setup()
      render(<EditPipelineInfo {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

      expect(defaultProps.onOpenChange).toHaveBeenCalledTimes(1)
    })

    it('should call onOpenChange when cancel button is clicked', () => {
      render(<EditPipelineInfo {...defaultProps} />)

      const cancelButton = screen.getByText(/operation\.cancel/i)
      fireEvent.click(cancelButton)

      expect(defaultProps.onOpenChange).toHaveBeenCalledTimes(1)
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

    it('should submit with Enter from the name input', async () => {
      const user = userEvent.setup()
      mockUpdatePipeline.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess()
        return Promise.resolve()
      })

      render(<EditPipelineInfo {...defaultProps} />)

      await user.click(screen.getByRole('textbox', { name: 'datasetPipeline.pipelineNameAndIcon' }))
      await user.keyboard('{Enter}')

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

    it('should call onOpenChange on successful save', async () => {
      mockUpdatePipeline.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess()
        return Promise.resolve()
      })

      render(<EditPipelineInfo {...defaultProps} />)

      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(defaultProps.onOpenChange).toHaveBeenCalled()
      })
    })
  })

  describe('Validation', () => {
    it('should show error toast when name is empty', async () => {
      render(<EditPipelineInfo {...defaultProps} />)

      const input = screen.getByDisplayValue('Test Pipeline')
      fireEvent.change(input, { target: { value: '' } })

      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('datasetPipeline.editPipelineInfoNameRequired')
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

  // Icon Types Tests (Branch Coverage for lines 29-30, 36-37)
  describe('Icon Types', () => {
    it('should initialize with emoji icon type when pipeline has emoji icon', () => {
      render(<EditPipelineInfo {...defaultProps} />)
      // Should render component with emoji icon
      expect(getIconButton()).toBeInTheDocument()
      expect(screen.getByDisplayValue('Test Pipeline')).toBeInTheDocument()
    })

    it('should initialize with image icon type when pipeline has image icon', async () => {
      const imagePipeline = createImagePipelineTemplate()
      // Verify test data has image icon type - this ensures the factory returns correct data
      expect(imagePipeline.icon.icon_type).toBe('image')
      expect(imagePipeline.icon.icon).toBe('file-id-123')
      expect(imagePipeline.icon.icon_url).toBe('https://example.com/icon.png')

      const props = {
        open: true,
        onOpenChange: vi.fn(),
        pipeline: imagePipeline,
      }
      render(<EditPipelineInfo {...props} />)
      // Component should initialize with image icon state
      expect(screen.getByDisplayValue('Image Pipeline')).toBeInTheDocument()
      expect(getIconButton()).toBeInTheDocument()
    })

    it('should render correctly with image icon and then update', () => {
      // This test exercises both the initialization and update paths for image icon
      const imagePipeline = createImagePipelineTemplate()
      const props = {
        ...defaultProps,
        pipeline: imagePipeline,
      }
      render(<EditPipelineInfo {...props} />)

      // Verify component rendered with image pipeline
      expect(screen.getByDisplayValue('Image Pipeline')).toBeInTheDocument()

      // Open icon picker
      fireEvent.click(getIconButton())
      expect(screen.getByPlaceholderText('app.iconPicker.search')).toBeInTheDocument()
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

    it('should revert to initial image icon when picker is closed without selection', async () => {
      const props = {
        ...defaultProps,
        pipeline: createImagePipelineTemplate(),
      }
      render(<EditPipelineInfo {...props} />)

      // Open picker
      fireEvent.click(getIconButton())
      expect(screen.getByPlaceholderText('app.iconPicker.search')).toBeInTheDocument()

      // Close without selection - should revert to original image icon
      await userEvent.setup().keyboard('{Escape}')

      await waitFor(() => {
        expect(screen.queryByPlaceholderText('app.iconPicker.search')).not.toBeInTheDocument()
      })
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
      render(<EditPipelineInfo {...props} />)

      // Open picker and select emoji
      fireEvent.click(getIconButton())
      fireEvent.click(screen.getByRole('tab', { name: 'app.iconPicker.emoji' }))
      const emojiButton = await screen.findByRole('gridcell', { name: 'Grinning face' })
      expect(emojiButton).toBeTruthy()
      fireEvent.click(emojiButton!)
      fireEvent.click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
      fireEvent.click(screen.getByRole('button', { name: /iconPicker\.ok/ }))

      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockUpdatePipeline).toHaveBeenCalledWith(
          expect.objectContaining({
            icon_info: expect.objectContaining({
              icon_type: 'emoji',
              icon: expect.any(String),
              icon_background: '#F3FEE7',
            }),
          }),
          expect.any(Object),
        )
      })
    })

    it('should switch to the image tab in the real picker', () => {
      render(<EditPipelineInfo {...defaultProps} />)

      fireEvent.click(getIconButton())
      fireEvent.click(screen.getByRole('tab', { name: /iconPicker\.image/ }))

      expect(screen.getByRole('tab', { name: /iconPicker\.image/ })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(screen.queryByRole('button', { name: /iconPicker\.ok/ })).not.toBeInTheDocument()
    })
  })

  // IconPickerDialog Tests (Branch Coverage)
  describe('IconPickerDialog', () => {
    it('should not show picker initially', () => {
      render(<EditPipelineInfo {...defaultProps} />)
      expect(screen.queryByPlaceholderText('app.iconPicker.search')).not.toBeInTheDocument()
    })

    it('should open picker when icon is clicked', () => {
      render(<EditPipelineInfo {...defaultProps} />)
      fireEvent.click(getIconButton())

      expect(screen.getByPlaceholderText('app.iconPicker.search')).toBeInTheDocument()
    })

    it('should close picker and update icon when emoji style is selected', async () => {
      render(<EditPipelineInfo {...defaultProps} />)
      fireEvent.click(getIconButton())

      fireEvent.click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
      fireEvent.click(screen.getByRole('button', { name: /iconPicker\.ok/ }))

      await waitFor(() => {
        expect(screen.queryByPlaceholderText('app.iconPicker.search')).not.toBeInTheDocument()
      })
    })

    it('should keep picker open when only switching to image tab', () => {
      render(<EditPipelineInfo {...defaultProps} />)
      fireEvent.click(getIconButton())

      fireEvent.click(screen.getByRole('tab', { name: /iconPicker\.image/ }))

      expect(screen.getByRole('tab', { name: /iconPicker\.image/ })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(screen.queryByRole('button', { name: /iconPicker\.ok/ })).not.toBeInTheDocument()
    })

    it('should revert icon when picker is closed without selection', async () => {
      render(<EditPipelineInfo {...defaultProps} />)
      fireEvent.click(getIconButton())

      await userEvent.setup().keyboard('{Escape}')

      await waitFor(() => {
        expect(screen.queryByPlaceholderText('app.iconPicker.search')).not.toBeInTheDocument()
      })
    })

    it('should save with new emoji icon selection', async () => {
      mockUpdatePipeline.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess()
        return Promise.resolve()
      })

      const user = userEvent.setup()
      render(<EditPipelineInfo {...defaultProps} />)

      // Open picker and select new emoji
      await user.click(getIconButton())
      await user.click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
      await user.click(screen.getByRole('button', { name: /iconPicker\.ok/ }))
      await waitFor(() =>
        expect(screen.queryByPlaceholderText('app.iconPicker.search')).not.toBeInTheDocument(),
      )
      expect(mockUpdatePipeline).not.toHaveBeenCalled()

      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockUpdatePipeline).toHaveBeenCalledWith(
          expect.objectContaining({
            icon_info: expect.objectContaining({
              icon_type: 'emoji',
              icon: '📊',
              icon_background: '#F3FEE7',
            }),
          }),
          expect.any(Object),
        )
      })
    })

    it('should save after confirming a real emoji selection from an image icon', async () => {
      mockUpdatePipeline.mockImplementation((_data, callbacks) => {
        callbacks.onSuccess()
        return Promise.resolve()
      })

      render(<EditPipelineInfo {...defaultProps} pipeline={createImagePipelineTemplate()} />)

      fireEvent.click(getIconButton())
      fireEvent.click(screen.getByRole('tab', { name: 'app.iconPicker.emoji' }))
      const emojiButton = await screen.findByRole('gridcell', { name: 'Grinning face' })
      expect(emojiButton).toBeTruthy()
      fireEvent.click(emojiButton!)
      fireEvent.click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
      fireEvent.click(screen.getByRole('button', { name: /iconPicker\.ok/ }))

      const saveButton = screen.getByText(/operation\.save/i)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockUpdatePipeline).toHaveBeenCalledWith(
          expect.objectContaining({
            icon_info: expect.objectContaining({
              icon_type: 'emoji',
              icon: expect.any(String),
              icon_background: '#F3FEE7',
            }),
          }),
          expect.any(Object),
        )
      })
    })
  })

  // Save Request Tests
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

  describe('Layout', () => {
    it('should have close button in header', () => {
      render(<EditPipelineInfo {...defaultProps} />)
      const closeButton = screen.getByRole('button', { name: 'common.operation.close' })
      expect(closeButton).toHaveClass('right-5', 'top-5')
    })
  })
  it('blocks dismissal and duplicate submits while pending, keeps a failed draft, and does not await invalidation', async () => {
    const user = userEvent.setup()
    let rejectRequest: (reason: Error) => void = () => {}
    mockUpdatePipeline
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            rejectRequest = reject
          }),
      )
      .mockResolvedValue(undefined)
    mockInvalidCustomizedTemplateList.mockReturnValue(new Promise<void>(() => {}))
    const onOpenChange = vi.fn()
    render(
      <EditPipelineInfo open pipeline={createPipelineTemplate()} onOpenChange={onOpenChange} />,
    )
    const name = screen.getByLabelText('datasetPipeline.pipelineNameAndIcon')
    await user.clear(name)
    await user.type(name, 'Retry template')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(mockUpdatePipeline).toHaveBeenCalledTimes(1))
    expect(name).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    expect(getIconButton()).toBeDisabled()
    await user.keyboard('{Enter}{Escape}')
    expect(mockUpdatePipeline).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalled()
    await act(async () => rejectRequest(new Error('Save failed')))
    await waitFor(() => expect(name).not.toHaveAttribute('readonly'))
    expect(name).toHaveValue('Retry template')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(mockUpdatePipeline).toHaveBeenCalledTimes(2)
    expect(mockInvalidCustomizedTemplateList).toHaveBeenCalledTimes(1)
  })

  it('discards a cancelled draft and reads the latest template after the popup exits', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<EditPipelineInfo {...defaultProps} />)
    await user.clear(screen.getByLabelText('datasetPipeline.pipelineNameAndIcon'))
    await user.type(screen.getByLabelText('datasetPipeline.pipelineNameAndIcon'), 'Cancelled')
    await user.keyboard('{Escape}')
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false)
    rerender(<EditPipelineInfo {...defaultProps} open={false} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    rerender(
      <EditPipelineInfo
        {...defaultProps}
        pipeline={createPipelineTemplate({ name: 'Latest template' })}
      />,
    )
    expect(screen.getByLabelText('datasetPipeline.pipelineNameAndIcon')).toHaveValue(
      'Latest template',
    )
  })
})

mockEmojiData()
