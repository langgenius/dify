import type { WorkflowToolDrawerPayload } from '../index'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowToolDrawer } from '../index'

vi.mock('@/app/components/base/emoji-picker/Inner', () => ({
  default: ({ onSelect }: { onSelect: (icon: string, background: string) => void }) => (
    <div data-testid="emoji-picker">
      <button data-testid="select-emoji" onClick={() => onSelect('🚀', '#000000')}>Emoji</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: ({ onClick, icon }: { onClick?: () => void, icon: string }) => (
    <button data-testid="app-icon" onClick={onClick}>{icon}</button>
  ),
}))

vi.mock('@/app/components/tools/labels/selector', () => ({
  default: ({ value, onChange }: { value: string[], onChange: (labels: string[]) => void }) => (
    <div data-testid="label-selector">
      <span>{value.join(',')}</span>
      <button data-testid="append-label" onClick={() => onChange([...value, 'new-label'])}>Add</button>
    </div>
  ),
}))

vi.mock('../confirm-modal', () => ({
  default: ({ show, onClose, onConfirm }: { show: boolean, onClose: () => void, onConfirm: () => void }) => (
    show
      ? (
          <div data-testid="confirm-modal">
            <button data-testid="confirm-save" onClick={onConfirm}>Confirm</button>
            <button data-testid="close-confirm" onClick={onClose}>Close</button>
          </div>
        )
      : null
  ),
}))

const mockToastNotify = vi.fn()
vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: (message: string) => mockToastNotify({ type: 'success', message }),
    error: (message: string) => mockToastNotify({ type: 'error', message }),
  },
}))

vi.mock('@/app/components/plugins/hooks', () => ({
  useTags: () => ({
    tags: [
      { name: 'label1', label: 'Label 1' },
      { name: 'label2', label: 'Label 2' },
    ],
  }),
}))

const createPayload = (overrides: Partial<WorkflowToolDrawerPayload> = {}): WorkflowToolDrawerPayload => ({
  icon: { content: '🔧', background: '#ffffff' },
  label: 'My Tool',
  name: 'my_tool',
  description: 'Tool description',
  parameters: [
    { name: 'param1', description: 'Parameter 1', form: 'llm', required: true, type: 'string' },
  ],
  outputParameters: [
    { name: 'output1', description: 'Output 1' },
    { name: 'text', description: 'Reserved output duplicate' },
  ],
  labels: ['label1'],
  privacy_policy: '',
  workflow_app_id: 'workflow-app-1',
  workflow_tool_id: 'workflow-tool-1',
  ...overrides,
})

describe('WorkflowToolDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create workflow tools with edited form values', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()

    render(
      <WorkflowToolDrawer
        isAdd
        payload={createPayload()}
        onHide={vi.fn()}
        onCreate={onCreate}
      />,
    )

    await user.clear(screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder'))
    await user.type(screen.getByPlaceholderText('tools.createTool.toolNamePlaceHolder'), 'Created Tool')
    await user.click(screen.getByTestId('append-label'))
    await user.click(screen.getByTestId('app-icon'))
    await user.click(screen.getByTestId('select-emoji'))
    await user.click(screen.getByRole('button', { name: 'app.iconPicker.ok' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      workflow_app_id: 'workflow-app-1',
      label: 'Created Tool',
      icon: { content: '🚀', background: '#000000' },
      labels: ['label1', 'new-label'],
    }))
  })

  it('should block invalid tool-call names before saving', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()

    render(
      <WorkflowToolDrawer
        isAdd
        payload={createPayload({ name: 'bad-name' })}
        onHide={vi.fn()}
        onCreate={onCreate}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onCreate).not.toHaveBeenCalled()
    expect(mockToastNotify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
    }))
  })

  it('should require confirmation before saving existing workflow tools', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()

    render(
      <WorkflowToolDrawer
        payload={createPayload()}
        onHide={vi.fn()}
        onSave={onSave}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()

    await user.click(screen.getByTestId('confirm-save'))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        workflow_tool_id: 'workflow-tool-1',
        name: 'my_tool',
      }))
    })
  })

  it('should show duplicate reserved output warnings', () => {
    render(
      <WorkflowToolDrawer
        isAdd
        payload={createPayload()}
        onHide={vi.fn()}
        onCreate={vi.fn()}
      />,
    )

    expect(screen.getAllByTestId('reserved-output-warning').length).toBeGreaterThan(0)
  })
})
