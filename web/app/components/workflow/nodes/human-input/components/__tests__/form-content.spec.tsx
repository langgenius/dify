import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import FormContent from '../form-content'

const mockUseTranslation = vi.hoisted(() => vi.fn())
const mockUseWorkflowVariableType = vi.hoisted(() => vi.fn())
const mockIsMac = vi.hoisted(() => vi.fn())
const mockPromptEditor = vi.hoisted(() => vi.fn())
const mockAddInputField = vi.hoisted(() => vi.fn())
const mockOnInsert = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
  Trans: ({
    i18nKey,
    components,
  }: {
    i18nKey: string
    components?: Record<string, ReactNode>
  }) => (
    <div>
      <div>{i18nKey}</div>
      {components?.CtrlKey}
      {components?.Key}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflowVariableType: () => mockUseWorkflowVariableType(),
}))

vi.mock('@/app/components/workflow/utils', () => ({
  isMac: () => mockIsMac(),
}))

vi.mock('@/app/components/base/prompt-editor', () => ({
  __esModule: true,
  default: (props: {
    onChange: (value: string) => void
    onFocus: () => void
    onBlur: () => void
    shortcutPopups?: Array<{
      Popup: (props: { onClose: () => void, onInsert: typeof mockOnInsert }) => ReactNode
    }>
    editable?: boolean
    hitlInputBlock: {
      workflowNodesMap: Record<string, unknown>
    }
  }) => {
    mockPromptEditor(props)
    const popup = props.shortcutPopups?.[0]
    return (
      <div>
        <button type="button" onClick={props.onFocus}>focus-editor</button>
        <button type="button" onClick={props.onBlur}>blur-editor</button>
        <button type="button" onClick={() => props.onChange('updated value')}>change-editor</button>
        {popup && popup.Popup({ onClose: vi.fn(), onInsert: mockOnInsert })}
      </div>
    )
  },
}))

vi.mock('../add-input-field', () => ({
  __esModule: true,
  default: (props: {
    onSave: (payload: {
      type: string
      output_variable_name: string
      default: {
        type: string
        selector: string[]
        value: string
      }
    }) => void
    onCancel: () => void
  }) => {
    mockAddInputField(props)
    return (
      <div>
        <button
          type="button"
          onClick={() => props.onSave({
            type: 'text-input',
            output_variable_name: 'approval',
            default: {
              type: 'variable',
              selector: ['node-1', 'answer'],
              value: '',
            },
          })}
        >
          save-input
        </button>
        <button type="button" onClick={props.onCancel}>cancel-input</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/base/prompt-editor/plugins/hitl-input-block', () => ({
  INSERT_HITL_INPUT_BLOCK_COMMAND: 'INSERT_HITL_INPUT_BLOCK_COMMAND',
}))

describe('FormContent', () => {
  const onChange = vi.fn()
  const onFormInputsChange = vi.fn()
  const onFormInputItemRename = vi.fn()
  const onFormInputItemRemove = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTranslation.mockReturnValue({
      t: (key: string) => key,
    })
    mockUseWorkflowVariableType.mockReturnValue(() => 'string')
    mockIsMac.mockReturnValue(false)
  })

  it('should build workflow node maps, show the hotkey tip on focus, and defer form-input sync until value changes', async () => {
    const { rerender } = render(
      <FormContent
        nodeId="node-2"
        value="Initial content"
        onChange={onChange}
        formInputs={[]}
        onFormInputsChange={onFormInputsChange}
        onFormInputItemRename={onFormInputItemRename}
        onFormInputItemRemove={onFormInputItemRemove}
        editorKey={1}
        isExpand={false}
        availableVars={[]}
        availableNodes={[
          {
            id: 'node-1',
            data: { title: 'Start', type: 'start' },
            position: { x: 0, y: 0 },
            width: 100,
            height: 40,
          } as never,
          {
            id: 'node-2',
            data: { title: 'Classifier', type: 'code' },
            position: { x: 120, y: 0 },
            width: 100,
            height: 40,
          } as never,
        ]}
      />,
    )

    expect(mockPromptEditor).toHaveBeenCalledWith(expect.objectContaining({
      editable: true,
      hitlInputBlock: expect.objectContaining({
        workflowNodesMap: expect.objectContaining({
          'node-1': expect.objectContaining({ title: 'Start' }),
          'node-2': expect.objectContaining({ title: 'Classifier' }),
          'sys': expect.objectContaining({ title: 'blocks.start' }),
        }),
      }),
    }))

    fireEvent.click(screen.getByText('focus-editor'))
    expect(screen.getByText('nodes.humanInput.formContent.hotkeyTip')).toBeInTheDocument()

    fireEvent.click(screen.getByText('save-input'))
    expect(mockOnInsert).toHaveBeenCalledWith('INSERT_HITL_INPUT_BLOCK_COMMAND', expect.objectContaining({
      variableName: 'approval',
      nodeId: 'node-2',
      formInputs: [expect.objectContaining({ output_variable_name: 'approval' })],
      onFormInputsChange,
      onFormInputItemRename,
      onFormInputItemRemove,
    }))
    expect(onFormInputsChange).not.toHaveBeenCalled()

    rerender(
      <FormContent
        nodeId="node-2"
        value="Initial content {{approval}}"
        onChange={onChange}
        formInputs={[]}
        onFormInputsChange={onFormInputsChange}
        onFormInputItemRename={onFormInputItemRename}
        onFormInputItemRemove={onFormInputItemRemove}
        editorKey={1}
        isExpand={false}
        availableVars={[]}
        availableNodes={[
          {
            id: 'node-1',
            data: { title: 'Start', type: 'start' },
            position: { x: 0, y: 0 },
            width: 100,
            height: 40,
          } as never,
        ]}
      />,
    )

    await waitFor(() => {
      expect(onFormInputsChange).toHaveBeenCalledWith([
        expect.objectContaining({ output_variable_name: 'approval' }),
      ])
    })
  })

  it('should disable editing helpers in readonly mode', () => {
    const { container } = render(
      <FormContent
        nodeId="node-2"
        value="Initial content"
        onChange={onChange}
        formInputs={[]}
        onFormInputsChange={onFormInputsChange}
        onFormInputItemRename={onFormInputItemRename}
        onFormInputItemRemove={onFormInputItemRemove}
        editorKey={1}
        isExpand={false}
        availableVars={[]}
        availableNodes={[]}
        readonly
      />,
    )

    expect(mockPromptEditor).toHaveBeenCalledWith(expect.objectContaining({
      editable: false,
      shortcutPopups: [],
    }))
    expect(screen.queryByText('save-input')).not.toBeInTheDocument()
    expect(container.firstChild).toHaveClass('pointer-events-none')
  })

  it('should render the mac hotkey hint when focused on macOS', () => {
    mockIsMac.mockReturnValue(true)

    render(
      <FormContent
        nodeId="node-2"
        value="Initial content"
        onChange={onChange}
        formInputs={[]}
        onFormInputsChange={onFormInputsChange}
        onFormInputItemRename={onFormInputItemRename}
        onFormInputItemRemove={onFormInputItemRemove}
        editorKey={1}
        isExpand={false}
        availableVars={[]}
        availableNodes={[]}
      />,
    )

    fireEvent.click(screen.getByText('focus-editor'))

    expect(screen.getByText('⌘')).toBeInTheDocument()
    expect(screen.getByText('/')).toBeInTheDocument()
  })
})
