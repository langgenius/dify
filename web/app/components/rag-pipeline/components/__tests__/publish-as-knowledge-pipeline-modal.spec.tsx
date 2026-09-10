import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import PublishAsKnowledgePipelineModal from '../publish-as-knowledge-pipeline-modal'

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      knowledgeName: 'Test Pipeline',
      knowledgeIcon: {
        icon_type: 'emoji',
        icon: '🔧',
        icon_background: '#fff',
        icon_url: '',
      },
    }),
  }),
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: () => <div />,
}))

describe('PublishAsKnowledgePipelineModal', () => {
  const mockOnCancel = vi.fn()
  const mockOnConfirm = vi.fn().mockResolvedValue(undefined)

  const defaultProps = {
    onCancel: mockOnCancel,
    onConfirm: mockOnConfirm,
  }
  const getNameInput = () =>
    screen.getByRole('textbox', { name: 'pipeline.common.publishAsPipeline.name' })
  const getIconButton = () =>
    screen.getByRole('button', {
      name: 'common.operation.edit pipeline.common.publishAsPipeline.name',
    })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should render modal with title', () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    expect(screen.getByRole('dialog', { name: 'pipeline.common.publishAs' })).toBeInTheDocument()
  })

  it('should initialize with knowledgeName from store', () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    const nameInput = getNameInput() as HTMLInputElement
    expect(nameInput.value).toBe('Test Pipeline')
  })

  it('should initialize description as empty', () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    const textarea = screen.getByRole('textbox', {
      name: 'pipeline.common.publishAsPipeline.description',
    }) as HTMLTextAreaElement
    expect(textarea.value).toBe('')
  })

  it('should call onCancel when close button clicked', () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('should call onCancel when cancel button clicked', () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    fireEvent.click(screen.getByText('common.operation.cancel'))

    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('should call onCancel when Escape is pressed', async () => {
    const user = userEvent.setup()
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    await user.keyboard('{Escape}')

    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('should call onConfirm with name, icon, and description when confirm clicked', () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    fireEvent.click(screen.getByText('workflow.common.publish'))

    expect(mockOnConfirm).toHaveBeenCalledWith(
      'Test Pipeline',
      expect.objectContaining({ icon_type: 'emoji', icon: '🔧' }),
      '',
    )
  })

  it('should update pipeline name when input changes', () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    const nameInput = getNameInput()
    fireEvent.change(nameInput, { target: { value: 'New Name' } })

    expect((nameInput as HTMLInputElement).value).toBe('New Name')
  })

  it('should update description when textarea changes', () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    const textarea = screen.getByRole('textbox', {
      name: 'pipeline.common.publishAsPipeline.description',
    })
    fireEvent.change(textarea, { target: { value: 'My description' } })

    expect((textarea as HTMLTextAreaElement).value).toBe('My description')
  })

  it('should not submit with Enter when name is empty', async () => {
    const user = userEvent.setup()
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    const nameInput = getNameInput()
    await user.clear(nameInput)

    const confirmBtn = screen.getByText('workflow.common.publish')
    expect(confirmBtn).toBeDisabled()

    await user.click(nameInput)
    await user.keyboard('{Enter}')

    expect(mockOnConfirm).not.toHaveBeenCalled()
  })

  it('should disable confirm button when confirmDisabled is true', () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} confirmDisabled />)

    const confirmBtn = screen.getByText('workflow.common.publish')
    expect(confirmBtn).toBeDisabled()
  })

  it('should not call onConfirm when confirmDisabled is true', () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} confirmDisabled />)

    fireEvent.click(screen.getByText('workflow.common.publish'))

    expect(mockOnConfirm).not.toHaveBeenCalled()
  })

  it('should show icon picker when app icon clicked', async () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    expect(screen.queryByPlaceholderText('Search emojis...')).not.toBeInTheDocument()

    fireEvent.click(getIconButton())

    expect(screen.getByPlaceholderText('Search emojis...')).toBeInTheDocument()
  })

  it('should update icon when emoji style is selected', async () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    fireEvent.click(getIconButton())
    fireEvent.click(screen.getByRole('button', { name: '#E4FBCC' }))
    fireEvent.click(screen.getByRole('button', { name: /iconPicker\.ok/ }))

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search emojis...')).not.toBeInTheDocument()
    })
  })

  it('should keep icon picker open until confirmation', () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    fireEvent.click(getIconButton())
    fireEvent.click(screen.getByRole('button', { name: '#E4FBCC' }))

    expect(screen.getByPlaceholderText('Search emojis...')).toBeInTheDocument()
  })

  it('should close icon picker when cancel is clicked', async () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    fireEvent.click(getIconButton())
    fireEvent.click(screen.getByRole('button', { name: /iconPicker\.cancel/ }))

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search emojis...')).not.toBeInTheDocument()
    })
  })

  it('should trim name and description when submitted with Enter', async () => {
    const user = userEvent.setup()
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    const nameInput = getNameInput()
    await user.clear(nameInput)
    await user.type(nameInput, '  Trimmed Name  ')

    const textarea = screen.getByRole('textbox', {
      name: 'pipeline.common.publishAsPipeline.description',
    })
    await user.type(textarea, '  Some desc  ')

    await user.click(nameInput)
    await user.keyboard('{Enter}')

    expect(mockOnConfirm).toHaveBeenCalledWith('Trimmed Name', expect.any(Object), 'Some desc')
  })
})
