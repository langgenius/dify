import type { Topic } from '@/app/components/workflow/nodes/_base/components/branch-list/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
