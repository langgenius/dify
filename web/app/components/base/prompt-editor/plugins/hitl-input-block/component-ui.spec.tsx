import type { ReactElement } from 'react'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType } from '@/app/components/workflow/types'
import HITLInputComponentUI from './component-ui'
import { HITLInputNode } from './node'

const createFormInput = (overrides?: Partial<FormInputItem>): FormInputItem => ({
  type: InputVarType.paragraph,
  output_variable_name: 'user_name',
  default: {
    type: 'constant',
    selector: [],
    value: 'hello',
  },
  ...overrides,
})

const renderWithLexical = (ui: ReactElement) => {
  return render(
    <LexicalComposer
      initialConfig={{
        namespace: 'hitl-input-component-ui-test',
        onError: (error: Error) => {
          throw error
        },
        nodes: [HITLInputNode],
      }}
    >
      {ui}
    </LexicalComposer>,
  )
}

const getActionContainers = () => {
  const [editButton, removeButton] = screen.getAllByRole('button')
  const editContainer = editButton.parentElement
  const removeContainer = removeButton.parentElement

  if (!editContainer || !removeContainer)
    throw new Error('Expected action containers to exist')

  return { editContainer, removeContainer }
}

const openEditModal = async () => {
  const { editContainer } = getActionContainers()
  await waitFor(() => {
    editContainer.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
  const dialog = screen.getByRole('dialog')

  const saveButton = within(dialog).getByRole('button', { name: 'common.operation.save' })
  expect(saveButton).toBeEnabled()
  return saveButton
}

describe('HITLInputComponentUI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render constant default value and call onRemove when remove action is clicked', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()

    render(
      <HITLInputComponentUI
        nodeId="node-1"
        varName="user_name"
        formInput={createFormInput()}
        onChange={vi.fn()}
        onRename={vi.fn()}
        onRemove={onRemove}
        workflowNodesMap={{}}
      />,
    )

    expect(screen.getByText('hello')).toBeInTheDocument()

    const { removeContainer } = getActionContainers()
    await user.click(removeContainer)

    expect(onRemove).toHaveBeenCalledWith('user_name')
  })

  it('should call onRename when variable name is changed in edit modal', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onRename = vi.fn()

    render(
      <HITLInputComponentUI
        nodeId="node-3"
        varName="user_name"
        formInput={createFormInput({
          output_variable_name: 'renamed_var',
        })}
        onChange={onChange}
        onRename={onRename}
        onRemove={vi.fn()}
        workflowNodesMap={{}}
      />,
    )

    const saveButton = await openEditModal()
    await user.click(saveButton)

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledTimes(1)
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(onRename.mock.calls[0][1]).toBe('user_name')
  })

  it('should render variable mode block when default value type is variable', () => {
    renderWithLexical(
      <HITLInputComponentUI
        nodeId="node-4"
        varName="user_name"
        formInput={createFormInput({
          default: {
            type: 'variable',
            selector: ['sys', 'query'],
            value: '',
          },
        })}
        onChange={vi.fn()}
        onRename={vi.fn()}
        onRemove={vi.fn()}
        workflowNodesMap={{}}
      />,
    )

    expect(screen.getByText(/query/i)).toBeInTheDocument()
  })

  it('should hide action buttons when readonly is true', () => {
    render(
      <HITLInputComponentUI
        nodeId="node-5"
        varName="user_name"
        formInput={createFormInput()}
        onChange={vi.fn()}
        onRename={vi.fn()}
        onRemove={vi.fn()}
        workflowNodesMap={{}}
        readonly
      />,
    )

    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
