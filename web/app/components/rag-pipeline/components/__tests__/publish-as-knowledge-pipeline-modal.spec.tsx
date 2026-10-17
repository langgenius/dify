import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { mockEmojiData, renderWithEmoji as render } from '@/test/emoji-picker'
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

  it('should call onCancel when close button clicked', async () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(mockOnCancel).toHaveBeenCalledOnce()
    expect(mockOnConfirm).not.toHaveBeenCalled()
  })

  it('should call onCancel when cancel button clicked', async () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    await userEvent.setup().click(screen.getByText('common.operation.cancel'))

    expect(mockOnCancel).toHaveBeenCalledOnce()
    expect(mockOnConfirm).not.toHaveBeenCalled()
  })

  it('should call onCancel when Escape is pressed', async () => {
    const user = userEvent.setup()
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    await user.keyboard('{Escape}')

    expect(mockOnCancel).toHaveBeenCalledOnce()
    expect(mockOnConfirm).not.toHaveBeenCalled()
  })

  it('should call onConfirm with name, icon, and description when confirm clicked', async () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    await userEvent.setup().click(screen.getByText('workflow.common.publish'))

    expect(mockOnConfirm).toHaveBeenCalledWith(
      'Test Pipeline',
      expect.objectContaining({ icon_type: 'emoji', icon: '🔧' }),
      '',
    )
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

  it('should not call onConfirm when confirmDisabled is true', async () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} confirmDisabled />)

    await userEvent.setup().click(screen.getByText('workflow.common.publish'))

    expect(mockOnConfirm).not.toHaveBeenCalled()
  })

  it('should update icon when emoji style is selected', async () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    await userEvent.setup().click(getIconButton())
    await userEvent.setup().click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
    await userEvent.setup().click(screen.getByRole('button', { name: /iconPicker\.ok/ }))

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('app.iconPicker.search')).not.toBeInTheDocument()
    })
    await userEvent.setup().click(screen.getByRole('button', { name: 'workflow.common.publish' }))
    expect(mockOnConfirm).toHaveBeenCalledWith(
      'Test Pipeline',
      {
        icon_type: 'emoji',
        icon: '🔧',
        icon_background: '#F3FEE7',
        icon_url: '',
      },
      '',
    )
  })

  it('should close icon picker when Escape is pressed', async () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    await userEvent.setup().click(getIconButton())
    await userEvent.setup().click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
    await userEvent.setup().keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('app.iconPicker.search')).not.toBeInTheDocument()
    })
    await userEvent.setup().click(screen.getByRole('button', { name: 'workflow.common.publish' }))
    expect(mockOnConfirm).toHaveBeenCalledWith(
      'Test Pipeline',
      {
        icon_type: 'emoji',
        icon: '🔧',
        icon_background: '#fff',
        icon_url: '',
      },
      '',
    )
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

mockEmojiData()
