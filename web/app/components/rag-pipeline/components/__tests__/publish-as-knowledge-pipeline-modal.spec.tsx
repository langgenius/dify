import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@langgenius/dify-ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode, open?: boolean }) =>
    open === false ? null : <>{children}</>,
  DialogContent: ({ children, className }: { children: React.ReactNode, className?: string }) => (
    <div data-testid="modal" className={className}>{children}</div>
  ),
  DialogTitle: ({ children, className }: { children: React.ReactNode, className?: string }) => (
    <h2 className={className}>{children}</h2>
  ),
}))

vi.mock('@langgenius/dify-ui/button', () => ({
  Button: ({ children, onClick, disabled, ...props }: Record<string, unknown>) => (
    <button onClick={onClick as () => void} disabled={disabled as boolean} {...props}>
      {children as string}
    </button>
  ),
}))

vi.mock('@/app/components/base/input', () => ({
  default: ({ value, onChange, ...props }: Record<string, unknown>) => (
    <input
      data-testid="name-input"
      value={value as string}
      onChange={onChange as () => void}
      {...props}
    />
  ),
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: ({ onClick }: { onClick?: () => void }) => (
    <div data-testid="app-icon" onClick={onClick} />
  ),
}))

vi.mock('es-toolkit/function', () => ({
  noop: () => {},
}))

describe('PublishAsKnowledgePipelineModal', () => {
  const mockOnCancel = vi.fn()
  const mockOnConfirm = vi.fn().mockResolvedValue(undefined)

  const defaultProps = {
    onCancel: mockOnCancel,
    onConfirm: mockOnConfirm,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should render modal with title', () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    expect(screen.getByTestId('modal')).toBeInTheDocument()
    expect(screen.getByText('pipeline.common.publishAs')).toBeInTheDocument()
  })

  it('should initialize with knowledgeName from store', () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    const nameInput = screen.getByTestId('name-input') as HTMLInputElement
    expect(nameInput.value).toBe('Test Pipeline')
  })

  it('should initialize description as empty', () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    const textarea = screen.getByRole('textbox', { name: 'pipeline.common.publishAsPipeline.description' }) as HTMLTextAreaElement
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

    const nameInput = screen.getByTestId('name-input')
    fireEvent.change(nameInput, { target: { value: 'New Name' } })

    expect((nameInput as HTMLInputElement).value).toBe('New Name')
  })

  it('should update description when textarea changes', () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    const textarea = screen.getByRole('textbox', { name: 'pipeline.common.publishAsPipeline.description' })
    fireEvent.change(textarea, { target: { value: 'My description' } })

    expect((textarea as HTMLTextAreaElement).value).toBe('My description')
  })

  it('should disable confirm button when name is empty', () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    const nameInput = screen.getByTestId('name-input')
    fireEvent.change(nameInput, { target: { value: '' } })

    const confirmBtn = screen.getByText('workflow.common.publish')
    expect(confirmBtn).toBeDisabled()
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

    fireEvent.click(screen.getByTestId('app-icon'))

    expect(screen.getByPlaceholderText('Search emojis...')).toBeInTheDocument()
  })

  it('should update icon when emoji style is selected', async () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    fireEvent.click(screen.getByTestId('app-icon'))
    fireEvent.click(screen.getByRole('button', { name: '#E4FBCC' }))
    fireEvent.click(screen.getByRole('button', { name: /iconPicker\.ok/ }))

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search emojis...')).not.toBeInTheDocument()
    })
  })

  it('should keep icon picker open until confirmation', () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    fireEvent.click(screen.getByTestId('app-icon'))
    fireEvent.click(screen.getByRole('button', { name: '#E4FBCC' }))

    expect(screen.getByPlaceholderText('Search emojis...')).toBeInTheDocument()
  })

  it('should close icon picker when cancel is clicked', async () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    fireEvent.click(screen.getByTestId('app-icon'))
    fireEvent.click(screen.getByRole('button', { name: /iconPicker\.cancel/ }))

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search emojis...')).not.toBeInTheDocument()
    })
  })

  it('should trim name and description before submitting', () => {
    render(<PublishAsKnowledgePipelineModal {...defaultProps} />)

    const nameInput = screen.getByTestId('name-input')
    fireEvent.change(nameInput, { target: { value: '  Trimmed Name  ' } })

    const textarea = screen.getByRole('textbox', { name: 'pipeline.common.publishAsPipeline.description' })
    fireEvent.change(textarea, { target: { value: '  Some desc  ' } })

    fireEvent.click(screen.getByText('workflow.common.publish'))

    expect(mockOnConfirm).toHaveBeenCalledWith(
      'Trimmed Name',
      expect.any(Object),
      'Some desc',
    )
  })
})
