import type { ReactElement } from 'react'
import type { PipelineTemplate } from '@/models/pipeline'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { QueryClient } from '@tanstack/react-query'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ChunkingMode } from '@/models/datasets'
import { mockEmojiData, renderWithEmoji as testingLibraryRender } from '@/test/emoji-picker'
import EditPipelineInfo from '../edit-pipeline-info'

const render = (ui: ReactElement<{ onClose: () => void }>) =>
  testingLibraryRender(
    <Dialog open onOpenChange={(open) => !open && ui.props.onClose()}>
      <DialogContent>{ui}</DialogContent>
    </Dialog>,
  )

const mockUpdatePipeline = vi.fn()

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipeline.customized.templates.byTemplateId.patch': (input) => mockUpdatePipeline(input),
    }),
  }
})

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
    onClose: vi.fn(),
    pipeline: createPipelineTemplate(),
  }
  const getIconButton = () =>
    screen.getByRole('button', {
      name: 'common.operation.edit datasetPipeline.pipelineNameAndIcon',
    })

  beforeEach(() => {
    vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    vi.clearAllMocks()
    mockToastError.mockReset()
  })

  describe('User Interactions', () => {
    it('should call onClose when close button is clicked', async () => {
      const user = userEvent.setup()
      render(<EditPipelineInfo {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when cancel button is clicked', async () => {
      render(<EditPipelineInfo {...defaultProps} />)

      const cancelButton = screen.getByText(/operation\.cancel/i)
      await userEvent.setup().click(cancelButton)

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('should submit with Enter from the name input', async () => {
      const user = userEvent.setup()
      mockUpdatePipeline.mockResolvedValue(undefined)

      render(<EditPipelineInfo {...defaultProps} />)

      const name = screen.getByRole('textbox', { name: 'datasetPipeline.pipelineNameAndIcon' })
      await user.clear(name)
      await user.type(name, 'Updated pipeline')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(mockUpdatePipeline).toHaveBeenCalledWith(
          expect.objectContaining({
            params: { template_id: 'pipeline-1' },
            body: expect.objectContaining({ name: 'Updated pipeline' }),
          }),
        )
      })
    })

    it('should invalidate template list on successful save', async () => {
      mockUpdatePipeline.mockResolvedValue(undefined)

      render(<EditPipelineInfo {...defaultProps} />)

      const saveButton = screen.getByText(/operation\.save/i)
      await userEvent.setup().click(saveButton)

      await waitFor(() => {
        expect(QueryClient.prototype.invalidateQueries).toHaveBeenCalledWith({
          queryKey: expect.arrayContaining([['console', 'rag', 'pipeline', 'templates', 'get']]),
        })
      })
    })

    it('should call onClose on successful save', async () => {
      mockUpdatePipeline.mockResolvedValue(undefined)

      render(<EditPipelineInfo {...defaultProps} />)

      const saveButton = screen.getByText(/operation\.save/i)
      await userEvent.setup().click(saveButton)

      await waitFor(() => {
        expect(defaultProps.onClose).toHaveBeenCalled()
      })
    })
  })

  describe('Validation', () => {
    it('should show error toast when name is empty', async () => {
      render(<EditPipelineInfo {...defaultProps} />)

      const input = screen.getByDisplayValue('Test Pipeline')
      fireEvent.change(input, { target: { value: '' } })

      const saveButton = screen.getByText(/operation\.save/i)
      await userEvent.setup().click(saveButton)

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('datasetPipeline.editPipelineInfoNameRequired')
        expect(mockUpdatePipeline).not.toHaveBeenCalled()
      })
    })
  })

  // Icon Types Tests (Branch Coverage for lines 29-30, 36-37)
  describe('Icon Types', () => {
    it('should save correct icon_info when starting with image icon type', async () => {
      mockUpdatePipeline.mockResolvedValue(undefined)

      const props = {
        ...defaultProps,
        pipeline: createImagePipelineTemplate(),
      }
      render(<EditPipelineInfo {...props} />)

      const saveButton = screen.getByText(/operation\.save/i)
      await userEvent.setup().click(saveButton)

      await waitFor(() => {
        expect(mockUpdatePipeline).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({
              icon_info: expect.objectContaining({
                icon_type: 'image',
                icon: 'file-id-123',
              }),
            }),
          }),
        )
      })
    })

    it('should save correct icon_info when starting with emoji icon type', async () => {
      mockUpdatePipeline.mockResolvedValue(undefined)

      render(<EditPipelineInfo {...defaultProps} />)

      const saveButton = screen.getByText(/operation\.save/i)
      await userEvent.setup().click(saveButton)

      await waitFor(() => {
        expect(mockUpdatePipeline).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({
              icon_info: expect.objectContaining({
                icon_type: 'emoji',
                icon: '📊',
              }),
            }),
          }),
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
      await userEvent.setup().click(getIconButton())
      expect(screen.getByPlaceholderText('app.iconPicker.search')).toBeInTheDocument()

      // Close without selection - should revert to original image icon
      await userEvent.setup().keyboard('{Escape}')

      await waitFor(() => {
        expect(screen.queryByPlaceholderText('app.iconPicker.search')).not.toBeInTheDocument()
      })
      await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.save' }))
      await waitFor(() =>
        expect(mockUpdatePipeline).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({
              icon_info: expect.objectContaining({ icon_type: 'image', icon: 'file-id-123' }),
            }),
          }),
        ),
      )
    })
  })

  // IconPickerDialog Tests (Branch Coverage)
  describe('IconPickerDialog', () => {
    it('should save with new emoji icon selection', async () => {
      mockUpdatePipeline.mockResolvedValue(undefined)

      render(<EditPipelineInfo {...defaultProps} />)

      // Open picker and select new emoji
      await userEvent.setup().click(getIconButton())
      await userEvent
        .setup()
        .click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
      await userEvent.setup().click(screen.getByRole('button', { name: /iconPicker\.ok/ }))

      const saveButton = screen.getByText(/operation\.save/i)
      await userEvent.setup().click(saveButton)

      await waitFor(() => {
        expect(mockUpdatePipeline).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({
              icon_info: expect.objectContaining({
                icon_type: 'emoji',
                icon: '📊',
                icon_background: '#F3FEE7',
              }),
            }),
          }),
        )
      })
    })

    it('should save after confirming a real emoji selection from an image icon', async () => {
      mockUpdatePipeline.mockResolvedValue(undefined)

      render(<EditPipelineInfo {...defaultProps} pipeline={createImagePipelineTemplate()} />)

      await userEvent.setup().click(getIconButton())
      await userEvent.setup().click(screen.getByRole('tab', { name: 'app.iconPicker.emoji' }))
      const emojiButton = await screen.findByRole('gridcell', { name: 'Grinning face' })
      await userEvent.setup().click(emojiButton)
      await userEvent
        .setup()
        .click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
      await userEvent.setup().click(screen.getByRole('button', { name: /iconPicker\.ok/ }))

      const saveButton = screen.getByText(/operation\.save/i)
      await userEvent.setup().click(saveButton)

      await waitFor(() => {
        expect(mockUpdatePipeline).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({
              icon_info: expect.objectContaining({
                icon_type: 'emoji',
                icon: '😀',
                icon_background: '#F3FEE7',
              }),
            }),
          }),
        )
      })
    })
  })

  // Save Request Tests
})

mockEmojiData()
