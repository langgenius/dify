import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { VarType } from '@/app/components/workflow/types'
import WorkflowToolForm from '../workflow-tool-form'

vi.mock('@/app/components/base/app-icon', () => ({
  default: ({ onClick }: { onClick?: () => void }) => (
    <button type="button" data-testid="app-icon" onClick={onClick}>icon</button>
  ),
}))

vi.mock('@/app/components/tools/labels/selector', () => ({
  default: ({ value, onChange }: { value: string[], onChange: (value: string[]) => void }) => (
    <button type="button" onClick={() => onChange([...value, 'new-label'])}>labels</button>
  ),
}))

vi.mock('../method-selector', () => ({
  default: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange('form')}>change method</button>
  ),
}))

vi.mock('@/app/components/base/ui/tooltip', () => ({
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render }: { render?: React.ReactNode }) => <>{render}</>,
  TooltipContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))

describe('WorkflowToolForm', () => {
  it('should wire form callbacks from the rendered controls', async () => {
    const user = userEvent.setup()
    const onTitleChange = vi.fn()
    const onNameChange = vi.fn()
    const onDescriptionChange = vi.fn()
    const onParameterChange = vi.fn()
    const onLabelChange = vi.fn()
    const onPrivacyPolicyChange = vi.fn()
    const onEmojiClick = vi.fn()
    const onHide = vi.fn()
    const onPrimaryAction = vi.fn()
    const onRemove = vi.fn()

    render(
      <WorkflowToolForm
        description="Test description"
        emoji={{ content: '🔧', background: '#ffffff' }}
        isNameValid={true}
        labels={['label1']}
        name="test_tool"
        onDescriptionChange={onDescriptionChange}
        onEmojiClick={onEmojiClick}
        onHide={onHide}
        onLabelChange={onLabelChange}
        onNameChange={onNameChange}
        onParameterChange={onParameterChange}
        onPrimaryAction={onPrimaryAction}
        onPrivacyPolicyChange={onPrivacyPolicyChange}
        onRemove={onRemove}
        onTitleChange={onTitleChange}
        outputParameters={[
          {
            name: 'text',
            description: 'Duplicate output',
            type: VarType.string,
          },
        ]}
        parameters={[
          {
            name: 'param1',
            description: 'Parameter 1',
            form: 'llm',
            required: true,
            type: 'string',
          },
        ]}
        privacyPolicy="https://example.com/privacy"
        title="Test Tool"
      />,
    )

    await user.click(screen.getByTestId('app-icon'))
    await user.type(screen.getByDisplayValue('Test Tool'), '!')
    await user.type(screen.getByDisplayValue('test_tool'), '!')
    await user.type(screen.getByDisplayValue('Test description'), '!')
    await user.click(screen.getByText('change method'))
    await user.type(screen.getByDisplayValue('Parameter 1'), '!')
    await user.click(screen.getByText('labels'))
    await user.type(screen.getByDisplayValue('https://example.com/privacy'), '/policy')
    await user.click(screen.getByText('common.operation.cancel'))
    await user.click(screen.getByText('common.operation.save'))
    await user.click(screen.getByText('common.operation.delete'))

    expect(onEmojiClick).toHaveBeenCalledTimes(1)
    expect(onTitleChange).toHaveBeenCalled()
    expect(onNameChange).toHaveBeenCalled()
    expect(onDescriptionChange).toHaveBeenCalled()
    expect(onParameterChange).toHaveBeenCalled()
    expect(onLabelChange).toHaveBeenCalledWith(['label1', 'new-label'])
    expect(onPrivacyPolicyChange).toHaveBeenCalled()
    expect(onHide).toHaveBeenCalledTimes(1)
    expect(onPrimaryAction).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(screen.getByText('tools.createTool.toolOutput.reservedParameterDuplicateTip')).toBeInTheDocument()
  })

  it('should render image parameters without a method selector in add mode', () => {
    render(
      <WorkflowToolForm
        description=""
        emoji={{ content: '🧪', background: '#000000' }}
        isAdd
        isNameValid={false}
        labels={[]}
        name="image_tool"
        onDescriptionChange={vi.fn()}
        onEmojiClick={vi.fn()}
        onHide={vi.fn()}
        onLabelChange={vi.fn()}
        onNameChange={vi.fn()}
        onParameterChange={vi.fn()}
        onPrimaryAction={vi.fn()}
        onPrivacyPolicyChange={vi.fn()}
        onTitleChange={vi.fn()}
        outputParameters={[
          {
            name: 'custom_output',
            description: 'Custom output',
            type: VarType.string,
          },
        ]}
        parameters={[
          {
            name: '__image',
            description: 'Image input',
            form: 'llm',
            required: false,
            type: 'file',
          },
        ]}
        privacyPolicy=""
        title="Image Tool"
      />,
    )

    expect(screen.getByText('tools.createTool.nameForToolCallTip')).toBeInTheDocument()
    expect(screen.getByText('tools.createTool.toolInput.methodParameter')).toBeInTheDocument()
    expect(screen.queryByText('change method')).not.toBeInTheDocument()
    expect(screen.queryByText('common.operation.delete')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('tools.createTool.privacyPolicyPlaceholder')).toBeInTheDocument()
  })
})
