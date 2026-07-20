import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { withSelectorKey } from '@/test/i18n-mock'
import FormContent from '../form-content'

const mockUseTranslation = vi.hoisted(() => vi.fn())
const mockUseWorkflowVariableType = vi.hoisted(() => vi.fn())
const mockFormatForDisplay = vi.hoisted(() => vi.fn((hotkey: string) => hotkey))
const mockPromptEditor = vi.hoisted(() => vi.fn())
const mockAddInputField = vi.hoisted(() => vi.fn())
const mockOnInsert = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', async () => {
  const { withSelectorKeyProps } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => mockUseTranslation(),
    Trans: withSelectorKeyProps(
      ({ i18nKey, components }: { i18nKey: string; components?: Record<string, ReactNode> }) => (
        <div>
          <div>{i18nKey}</div>
          {components?.CtrlKey}
          {components?.Key}
        </div>
      ),
    ),
  }
})

vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflowVariableType: () => mockUseWorkflowVariableType(),
}))

vi.mock('@tanstack/react-hotkeys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-hotkeys')>()
  return {
    ...actual,
    formatForDisplay: (hotkey: string) => mockFormatForDisplay(hotkey),
  }
})

vi.mock('@/app/components/base/prompt-editor', () => ({
  __esModule: true,
  default: (props: {
    onChange: (value: string) => void
    onFocus: () => void
    onBlur: () => void
    shortcutPopups?: Array<{
      Popup: (props: { onClose: () => void; onInsert: typeof mockOnInsert }) => ReactNode
    }>
    editable?: boolean
    hitlInputBlock: {
      workflowNodesMap: Record<string, unknown>
    }
  }) => {
    mockPromptEditor(props)
    const popup = props.shortcutPopups?.[0]
    const Popup = popup?.Popup
    return (
      <div>
        <button type="button" onClick={props.onFocus}>
          focus-editor
        </button>
        <button type="button" onClick={props.onBlur}>
          blur-editor
        </button>
        <button type="button" onClick={() => props.onChange('updated value')}>
          change-editor
        </button>
        {Popup && <Popup onClose={vi.fn()} onInsert={mockOnInsert} />}
      </div>
    )
  },
}))

vi.mock('../add-input-field', () => ({
  __esModule: true,
  default: function MockAddInputField(props: {
    unavailableVariableNames?: string[]
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
  }) {
    const [draftName, setDraftName] = React.useState('')

    mockAddInputField(props)
    return (
      <div>
        <input
          aria-label="field-name"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
        />
        <button
          type="button"
          onClick={() =>
            props.onSave({
              type: 'text-input',
              output_variable_name: 'approval',
              default: {
                type: 'variable',
                selector: ['node-1', 'answer'],
                value: '',
              },
            })
          }
        >
          save-input
        </button>
        <button type="button" onClick={props.onCancel}>
          cancel-input
        </button>
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
      t: withSelectorKey((key: string) => key),
    })
    mockUseWorkflowVariableType.mockReturnValue(() => 'string')
    mockFormatForDisplay.mockImplementation((hotkey: string) => hotkey)
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

    expect(mockPromptEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        editable: true,
        shortcutPopups: [
          expect.objectContaining({
            hotkey: ['mod', '/'],
            displayMode: 'workflow-panel-adjacent-center',
          }),
        ],
        hitlInputBlock: expect.objectContaining({
          workflowNodesMap: expect.objectContaining({
            'node-1': expect.objectContaining({ title: 'Start' }),
            'node-2': expect.objectContaining({ title: 'Classifier' }),
            sys: expect.objectContaining({ title: 'blocks.start' }),
          }),
        }),
      }),
    )

    fireEvent.click(screen.getByText('focus-editor'))
    expect(screen.getByText('nodes.humanInput.formContent.hotkeyTip')).toBeInTheDocument()

    fireEvent.click(screen.getByText('save-input'))
    expect(mockOnInsert).toHaveBeenCalledWith(
      'INSERT_HITL_INPUT_BLOCK_COMMAND',
      expect.objectContaining({
        variableName: 'approval',
        nodeId: 'node-2',
        formInputs: [expect.objectContaining({ output_variable_name: 'approval' })],
        onFormInputsChange,
        onFormInputItemRename,
        onFormInputItemRemove,
      }),
    )
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

    expect(mockPromptEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        editable: false,
        shortcutPopups: [],
      }),
    )
    expect(screen.queryByText('save-input')).not.toBeInTheDocument()
    expect(container.firstChild).toHaveClass('pointer-events-none')
  })

  it('should not insert a new input when the variable name already exists', () => {
    render(
      <FormContent
        nodeId="node-2"
        value="Initial content"
        onChange={onChange}
        formInputs={[
          {
            type: 'paragraph',
            output_variable_name: 'approval',
            default: {
              type: 'constant',
              selector: [],
              value: '',
            },
          } as never,
        ]}
        onFormInputsChange={onFormInputsChange}
        onFormInputItemRename={onFormInputItemRename}
        onFormInputItemRemove={onFormInputItemRemove}
        editorKey={1}
        isExpand={false}
        availableVars={[]}
        availableNodes={[]}
      />,
    )

    expect(mockAddInputField).toHaveBeenCalledWith(
      expect.objectContaining({
        unavailableVariableNames: ['approval'],
      }),
    )

    fireEvent.click(screen.getByText('save-input'))

    expect(mockOnInsert).not.toHaveBeenCalled()
    expect(onFormInputsChange).not.toHaveBeenCalled()
  })

  it('should render the mac hotkey hint when focused on macOS', () => {
    mockFormatForDisplay.mockReturnValue('⌘')

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

  it('should preserve add-input draft state across parent rerenders', () => {
    const props = {
      nodeId: 'node-2',
      value: 'Initial content',
      onChange,
      formInputs: [],
      onFormInputsChange,
      onFormInputItemRename,
      onFormInputItemRemove,
      editorKey: 1,
      isExpand: false,
      availableVars: [],
      availableNodes: [],
    }
    const { rerender } = render(<FormContent {...props} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'field-name' }), {
      target: { value: 'approval_name' },
    })

    rerender(<FormContent {...props} />)

    expect(screen.getByRole('textbox', { name: 'field-name' })).toHaveValue('approval_name')
  })
})
