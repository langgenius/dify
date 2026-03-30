import type { WorkflowToolModalPayload } from '../index'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import WorkflowToolAsModal from '../index'

const mockToastNotify = vi.fn()

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: (message: string) => mockToastNotify({ type: 'error', message }),
  },
}))

vi.mock('@/app/components/base/drawer-plus', () => ({
  default: ({ body }: { body: React.ReactNode }) => (
    <div data-testid="drawer">{body}</div>
  ),
}))

vi.mock('@/app/components/base/emoji-picker', () => ({
  default: ({ onSelect, onClose }: { onSelect: (icon: string, background: string) => void, onClose: () => void }) => (
    <div data-testid="emoji-picker">
      <button type="button" onClick={() => onSelect('🚀', '#f0f0f0')}>select emoji</button>
      <button type="button" onClick={onClose}>close emoji</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: ({ onClick, icon, background }: { onClick?: () => void, icon: string, background: string }) => (
    <button type="button" data-testid="app-icon" data-icon={icon} data-background={background} onClick={onClick}>
      icon
    </button>
  ),
}))

vi.mock('@/app/components/tools/labels/selector', () => ({
  default: ({ value, onChange }: { value: string[], onChange: (value: string[]) => void }) => (
    <div>
      <span data-testid="label-values">{value.join(',')}</span>
      <button type="button" onClick={() => onChange([...value, 'new-label'])}>add label</button>
    </div>
  ),
}))

vi.mock('../method-selector', () => ({
  default: ({ value, onChange }: { value: string, onChange: (value: string) => void }) => (
    <select aria-label="parameter method" value={value} onChange={e => onChange(e.target.value)}>
      <option value="llm">llm</option>
      <option value="form">form</option>
    </select>
  ),
}))

vi.mock('../confirm-modal', () => ({
  default: ({ show, onClose, onConfirm }: { show: boolean, onClose: () => void, onConfirm: () => void }) => (
    show
      ? (
          <div data-testid="confirm-modal">
            <button type="button" onClick={onConfirm}>confirm save</button>
            <button type="button" onClick={onClose}>cancel save</button>
          </div>
        )
      : null
  ),
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))

const createPayload = (overrides: Partial<WorkflowToolModalPayload> = {}): WorkflowToolModalPayload => ({
  icon: {
    content: '🔧',
    background: '#ffffff',
  },
  label: 'Test Tool',
  name: 'test_tool',
  description: 'Test description',
  parameters: [
    {
      name: 'param1',
      description: 'Parameter 1',
      form: 'llm',
      required: true,
      type: 'string',
    },
  ],
  outputParameters: [
    {
      name: 'text',
      description: 'Duplicate output',
      type: 'string',
    },
    {
      name: 'result',
      description: 'Result output',
      type: 'string',
    },
  ],
  labels: ['label1'],
  privacy_policy: 'https://example.com/privacy',
  workflow_app_id: 'workflow-app-123',
  workflow_tool_id: 'workflow-tool-456',
  ...overrides,
})

describe('WorkflowToolAsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should submit create payload with updated form state in add mode', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()

    render(
      <WorkflowToolAsModal
        isAdd
        payload={createPayload()}
        onHide={vi.fn()}
        onCreate={onCreate}
      />,
    )

    const titleInput = screen.getByDisplayValue('Test Tool')
    const nameInput = screen.getByDisplayValue('test_tool')
    const descriptionInput = screen.getByDisplayValue('Test description')
    const parameterDescriptionInput = screen.getByDisplayValue('Parameter 1')

    await user.click(screen.getByTestId('app-icon'))
    await user.click(screen.getByText('select emoji'))
    await user.clear(titleInput)
    await user.type(titleInput, 'Updated Tool')
    await user.clear(nameInput)
    await user.type(nameInput, 'updated_tool')
    await user.clear(descriptionInput)
    await user.type(descriptionInput, 'Updated description')
    await user.selectOptions(screen.getByLabelText('parameter method'), 'form')
    await user.clear(parameterDescriptionInput)
    await user.type(parameterDescriptionInput, 'Updated parameter')
    await user.click(screen.getByText('add label'))
    await user.click(screen.getByText('common.operation.save'))

    expect(onCreate).toHaveBeenCalledWith({
      description: 'Updated description',
      icon: {
        content: '🚀',
        background: '#f0f0f0',
      },
      label: 'Updated Tool',
      labels: ['label1', 'new-label'],
      name: 'updated_tool',
      parameters: [
        {
          name: 'param1',
          description: 'Updated parameter',
          form: 'form',
        },
      ],
      privacy_policy: 'https://example.com/privacy',
      workflow_app_id: 'workflow-app-123',
    })
  })

  it('should block submission and show an error when the tool-call name is invalid', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()

    render(
      <WorkflowToolAsModal
        isAdd
        payload={createPayload()}
        onHide={vi.fn()}
        onCreate={onCreate}
      />,
    )

    const nameInput = screen.getByDisplayValue('test_tool')
    await user.clear(nameInput)
    await user.type(nameInput, 'bad-name')
    await user.click(screen.getByText('common.operation.save'))

    expect(onCreate).not.toHaveBeenCalled()
    expect(mockToastNotify).toHaveBeenCalledWith({
      type: 'error',
      message: 'tools.createTool.nameForToolCalltools.createTool.nameForToolCallTip',
    })
  })

  it('should require confirmation before saving in edit mode', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()

    render(
      <WorkflowToolAsModal
        payload={createPayload()}
        onHide={vi.fn()}
        onSave={onSave}
      />,
    )

    await user.click(screen.getByText('common.operation.save'))
    expect(screen.getByTestId('confirm-modal')).toBeInTheDocument()

    await user.click(screen.getByText('confirm save'))

    expect(onSave).toHaveBeenCalledWith({
      description: 'Test description',
      icon: {
        content: '🔧',
        background: '#ffffff',
      },
      label: 'Test Tool',
      labels: ['label1'],
      name: 'test_tool',
      parameters: [
        {
          name: 'param1',
          description: 'Parameter 1',
          form: 'llm',
        },
      ],
      privacy_policy: 'https://example.com/privacy',
      workflow_tool_id: 'workflow-tool-456',
    })
  })
})
