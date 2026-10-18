import type { Topic } from '@/app/components/workflow/nodes/_base/components/branch-list/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import ClassItem from '../../../_base/components/branch-list/class-item'

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  __esModule: true,
  default: () => ({
    availableVars: [{ variable: ['node-1', 'answer'], type: 'string' }],
    availableNodesWithParent: [{ id: 'node-1', data: { title: 'Answer' } }],
  }),
}))

// The independently tested rich editor is outside this payload-preservation contract.
vi.mock('@/app/components/workflow/nodes/_base/components/prompt/editor', () => ({
  __esModule: true,
  default: (props: {
    title: React.ReactNode
    value: string
    onChange: (value: string) => void
    onRemove: () => void
    showRemove?: boolean
  }) => {
    return (
      <div>
        <div>{props.title}</div>
        <input
          aria-label="class-name"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
        {props.showRemove && (
          <button type="button" onClick={props.onRemove}>
            remove-item
          </button>
        )}
      </div>
    )
  },
}))

const createTopic = (overrides: Partial<Topic> = {}): Topic => ({
  id: 'topic-1',
  name: 'Billing questions',
  ...overrides,
})

describe('question-classifier/class-item', () => {
  it('forwards editor updates and remove actions', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onRemove = vi.fn()

    render(
      <ClassItem
        nodeId="node-1"
        payload={createTopic()}
        onChange={onChange}
        onRemove={onRemove}
        index={1}
        filterVar={() => true}
      />,
    )

    await user.tripleClick(screen.getByRole('textbox', { name: 'class-name' }))
    await user.paste('Billing questions updated')
    await user.click(screen.getByRole('button', { name: 'remove-item' }))

    expect(onChange).toHaveBeenCalledWith({
      id: 'topic-1',
      name: 'Billing questions updated',
    })
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'CLASS 1' })).toBeInTheDocument()
  })

  it('preserves a custom label when editing the classifier name', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <ClassItem
        nodeId="node-1"
        payload={createTopic({ label: 'Billing' })}
        onChange={onChange}
        onRemove={vi.fn()}
        index={1}
        filterVar={() => true}
      />,
    )

    await user.tripleClick(screen.getByRole('textbox', { name: 'class-name' }))
    await user.paste('Billing questions updated')

    expect(onChange).toHaveBeenCalledWith({
      id: 'topic-1',
      name: 'Billing questions updated',
      label: 'Billing',
    })
    expect(screen.getByRole('button', { name: 'Billing' })).toBeInTheDocument()
  })
})

it('preserves the group name during label editing and updates it on save', async () => {
  const user = userEvent.setup()
  function NamedClass({ readonly = false }: { readonly?: boolean }) {
    const [topic, setTopic] = useState(createTopic({ label: 'Billing' }))
    return (
      <div role="group" aria-labelledby="class-title">
        <ClassItem
          labelId="class-title"
          nodeId="node-1"
          payload={topic}
          onChange={setTopic}
          onRemove={vi.fn()}
          index={1}
          filterVar={() => true}
          readonly={readonly}
        />
      </div>
    )
  }
  const { rerender } = render(<NamedClass />)
  const group = screen.getByRole('group', { name: 'Billing' })
  await user.dblClick(screen.getByRole('button', { name: 'Billing' }))
  const labelInput = screen.getByRole('textbox', {
    name: 'workflowModels.nodes.questionClassifiers.labelEditorAriaLabel',
  })
  await user.clear(labelInput)
  await user.type(labelInput, 'Refunds')
  expect(group).toHaveAccessibleName('Billing')
  await user.keyboard('{Enter}')
  expect(group).toHaveAccessibleName('Refunds')
  rerender(<NamedClass readonly />)
  expect(group).toHaveAccessibleName('Refunds')
})
