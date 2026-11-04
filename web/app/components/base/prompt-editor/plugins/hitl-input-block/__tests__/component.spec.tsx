import type { ParagraphFormInput } from '@/app/components/workflow/nodes/human-input/types'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType } from '@/app/components/workflow/types'
import HITLInputComponent from '../component'
import { HITLInputNode } from '../node'

const createInput = (name = 'user_name'): ParagraphFormInput => ({
  type: InputVarType.paragraph,
  output_variable_name: name,
  default: { type: 'constant', selector: [], value: 'hello' },
})

const setup = async (formInputs: ParagraphFormInput[]) => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const onRename = vi.fn()
  render(
    <LexicalComposer
      initialConfig={{
        namespace: 'hitl-component',
        nodes: [HITLInputNode],
        onError: (error) => {
          throw error
        },
      }}
    >
      <HITLInputComponent
        nodeKey="input-node"
        nodeId="node-1"
        varName="user_name"
        formInputs={formInputs}
        onChange={onChange}
        onRename={onRename}
        onRemove={vi.fn()}
        workflowNodesMap={{}}
      />
    </LexicalComposer>,
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
  return { user, onChange, onRename }
}

it('appends a missing input after saving the field editor', async () => {
  const other = createInput('other_name')
  const { user, onChange } = await setup([other])
  await user.type(screen.getByRole('textbox', { name: /saveResponseAs/ }), 'user_name')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(onChange).toHaveBeenCalledWith([
    other,
    expect.objectContaining({ output_variable_name: 'user_name', type: InputVarType.paragraph }),
  ])
})

it('routes a rename through the editor rename callback', async () => {
  const { user, onChange, onRename } = await setup([createInput()])
  const name = screen.getByRole('textbox', { name: /saveResponseAs/ })
  await user.clear(name)
  await user.type(name, 'renamed_name')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(onRename).toHaveBeenCalledWith(createInput('renamed_name'), 'user_name')
  expect(onChange).not.toHaveBeenCalled()
})

it('prevents a duplicate name from being saved', async () => {
  const { user, onChange, onRename } = await setup([createInput(), createInput('other_name')])
  const name = screen.getByRole('textbox', { name: /saveResponseAs/ })
  await user.clear(name)
  await user.type(name, 'other_name')
  expect(screen.getByText(/variableNameDuplicated/)).toBeInTheDocument()
  const save = screen.getByRole('button', { name: 'common.operation.save' })
  expect(save).toBeDisabled()
  await user.click(save)
  expect(onChange).not.toHaveBeenCalled()
  expect(onRename).not.toHaveBeenCalled()
})

it('updates only the edited input while preserving the other fields', async () => {
  const other = createInput('other_name')
  const { user, onChange } = await setup([createInput(), other])
  const content = screen.getByRole('textbox', { name: /staticContent/ })
  await user.clear(content)
  await user.type(content, 'updated')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(onChange).toHaveBeenCalledWith([
    { ...createInput(), default: { type: 'constant', selector: [], value: 'updated' } },
    other,
  ])
})
