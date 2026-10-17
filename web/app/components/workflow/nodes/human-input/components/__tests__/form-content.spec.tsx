import type { ComponentProps, ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { INSERT_HITL_INPUT_BLOCK_COMMAND } from '@/app/components/base/prompt-editor/plugins/hitl-input-block'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { createDefaultParagraphFormInput } from '../../types'
import FormContent from '../form-content'

const mockPromptEditor = vi.hoisted(() => vi.fn())
const mockOnInsert = vi.hoisted(() => vi.fn())

vi.mock('../../../../hooks/use-workflow-variables', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../hooks/use-workflow-variables')>()),
  useWorkflowVariableType: () => () => VarType.string,
}))

// Lexical owns rendering inserted blocks. Exercise the real add-input form at its popup boundary.
vi.mock('@/app/components/base/prompt-editor', () => ({
  default: (props: {
    value: string
    onChange: (value: string) => void
    onFocus: () => void
    onBlur: () => void
    shortcutPopups?: Array<{
      Popup: (props: { onClose: () => void; onInsert: typeof mockOnInsert }) => ReactNode
    }>
    editable?: boolean
  }) => {
    mockPromptEditor(props)
    const Popup = props.shortcutPopups?.[0]?.Popup
    return (
      <>
        <textarea
          aria-label="Form content"
          value={props.value}
          readOnly={!props.editable}
          onFocus={props.onFocus}
          onBlur={props.onBlur}
          onChange={(event) => props.onChange(event.target.value)}
        />
        {Popup && <Popup onClose={vi.fn()} onInsert={mockOnInsert} />}
      </>
    )
  },
}))
vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: () => null,
}))

const createProps = (
  overrides: Partial<ComponentProps<typeof FormContent>> = {},
): ComponentProps<typeof FormContent> => ({
  nodeId: 'node-2',
  value: 'Initial content',
  onChange: vi.fn(),
  formInputs: [],
  onFormInputsChange: vi.fn(),
  onFormInputItemRename: vi.fn(),
  onFormInputItemRemove: vi.fn(),
  editorKey: 1,
  isExpand: false,
  availableVars: [],
  availableNodes: [
    createNode({ id: 'node-1', data: { title: 'Start', type: BlockEnum.Start, desc: '' } }),
    createNode({ id: 'node-2', data: { title: 'Code', type: BlockEnum.Code, desc: '' } }),
  ],
  ...overrides,
})
const getNameInput = () => screen.getByRole('textbox', { name: /insertInputField.saveResponseAs/ })
const getInsertButton = () => screen.getByRole('button', { name: /insertInputField.insert/ })

beforeEach(() => vi.clearAllMocks())

describe('FormContent', () => {
  it('inserts the configured input and synchronizes inputs only after the editor value changes', async () => {
    const user = userEvent.setup()
    const props = createProps()
    const { rerender } = render(<FormContent {...props} />)
    await user.click(screen.getByRole('textbox', { name: 'Form content' }))
    expect(
      screen.getByText('workflowHumanInput.nodes.humanInput.formContent.hotkeyTip'),
    ).toBeInTheDocument()
    await user.type(getNameInput(), 'approval')
    await user.click(getInsertButton())
    expect(mockOnInsert).toHaveBeenCalledWith(
      INSERT_HITL_INPUT_BLOCK_COMMAND,
      expect.objectContaining({
        variableName: 'approval',
        nodeId: 'node-2',
        formInputs: [createDefaultParagraphFormInput('approval')],
        onFormInputsChange: props.onFormInputsChange,
        onFormInputItemRename: props.onFormInputItemRename,
        onFormInputItemRemove: props.onFormInputItemRemove,
      }),
    )
    expect(props.onFormInputsChange).not.toHaveBeenCalled()
    rerender(<FormContent {...props} value="Initial content {{approval}}" />)
    await waitFor(() =>
      expect(props.onFormInputsChange).toHaveBeenCalledExactlyOnceWith([
        createDefaultParagraphFormInput('approval'),
      ]),
    )
    expect(mockPromptEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        hitlInputBlock: expect.objectContaining({
          workflowNodesMap: expect.objectContaining({
            'node-1': expect.objectContaining({ title: 'Start' }),
            'node-2': expect.objectContaining({ title: 'Code' }),
            sys: expect.objectContaining({ title: 'workflow.blocks.start' }),
          }),
        }),
      }),
    )
  })

  it('disables duplicate input names before insertion', async () => {
    const user = userEvent.setup()
    const props = createProps({ formInputs: [createDefaultParagraphFormInput('approval')] })
    render(<FormContent {...props} />)
    await user.type(getNameInput(), 'approval')
    expect(getInsertButton()).toBeDisabled()
    expect(screen.getByText(/insertInputField.variableNameDuplicated/)).toBeInTheDocument()
    await user.click(getInsertButton())
    expect(mockOnInsert).not.toHaveBeenCalled()
    expect(props.onFormInputsChange).not.toHaveBeenCalled()
  })

  it('keeps the add-input draft across parent rerenders', async () => {
    const props = createProps()
    const { rerender } = render(<FormContent {...props} />)
    await userEvent.setup().type(getNameInput(), 'approval_name')
    rerender(<FormContent {...props} />)
    expect(getNameInput()).toHaveValue('approval_name')
  })

  it('makes the editor readonly and removes input creation', () => {
    render(<FormContent {...createProps()} readonly />)
    expect(screen.getByRole('textbox', { name: 'Form content' })).toHaveAttribute('readonly')
    expect(
      screen.queryByRole('button', { name: /insertInputField.insert/ }),
    ).not.toBeInTheDocument()
  })
})
