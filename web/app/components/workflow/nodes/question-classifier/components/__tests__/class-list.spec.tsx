import type { Topic } from '@/app/components/workflow/nodes/_base/components/branch-list/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWorkflowFlowComponent as render } from '@/app/components/workflow/__tests__/workflow-test-env'
import ClassList from '../../../_base/components/branch-list/class-list'

// Class editing is covered by the adjacent integration suite; this boundary isolates list ordering.
vi.mock('../../../_base/components/branch-list/class-item', () => ({
  default: ({ payload, index, labelId }: { payload: Topic; index: number; labelId: string }) => (
    <div id={labelId}>{`${index}:${payload.name}`}</div>
  ),
}))

const createTopic = (overrides: Partial<Topic> = {}): Topic => ({
  id: 'topic-1',
  name: 'Billing questions',
  ...overrides,
})

describe('question-classifier/class-list', () => {
  it('confirms keyboard sorting through the branch-aware sort callback', async () => {
    const user = userEvent.setup()
    const handleSortTopic = vi.fn()
    const onChange = vi.fn()
    const topics = [createTopic(), createTopic({ id: 'topic-2', name: 'Refunds' })]
    function Fixture() {
      const [list, setList] = useState(topics)
      return (
        <ClassList
          nodeId="node-1"
          list={list}
          onChange={onChange}
          filterVar={() => true}
          handleSortTopic={(items) => {
            handleSortTopic(items)
            setList(items)
          }}
        />
      )
    }
    render(<Fixture />)
    const handle = screen.getAllByRole('button', { pressed: false })[0]!
    for (let index = 0; index < 10 && document.activeElement !== handle; index++) await user.tab()
    expect(handle).toHaveFocus()
    await user.keyboard('{Enter}{ArrowDown}')
    expect(screen.getByText('1:Refunds')).toBeInTheDocument()
    expect(handleSortTopic).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(handleSortTopic).toHaveBeenCalledExactlyOnceWith([topics[1], topics[0]])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('hides drag and add affordances when readonly', () => {
    render(
      <ClassList
        nodeId="node-1"
        list={[createTopic(), createTopic({ id: 'topic-2', name: 'Refunds' })]}
        onChange={vi.fn()}
        filterVar={() => true}
        readonly
      />,
    )

    expect(
      screen.queryByText('workflowModels.nodes.questionClassifiers.addClass'),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { pressed: false })).not.toBeInTheDocument()
  })
})
