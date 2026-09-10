import type { Topic } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useEdgesInteractions } from '../../../../hooks/use-edges-interactions'
import ClassList from '../class-list'

vi.mock('react-sortablejs', () => ({
  __esModule: true,
  ReactSortable: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('../../../../hooks/use-edges-interactions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../hooks/use-edges-interactions')>()
  return {
    ...actual,
    useEdgesInteractions: vi.fn(),
  }
})

vi.mock('../class-item', () => ({
  __esModule: true,
  default: ({
    payload,
    onChange,
    onRemove,
    index,
  }: {
    payload: Topic
    onChange: (value: Topic) => void
    onRemove: () => void
    index: number
  }) => (
    <div>
      <div>{`${index}:${payload.name}`}</div>
      <button
        type="button"
        onClick={() => onChange({ ...payload, name: `${payload.name} updated` })}
      >
        change-item
      </button>
      <button type="button" onClick={onRemove}>
        remove-item
      </button>
    </div>
  ),
}))

const mockUseEdgesInteractions = vi.mocked(useEdgesInteractions)

const createTopic = (overrides: Partial<Topic> = {}): Topic => ({
  id: 'topic-1',
  name: 'Billing questions',
  ...overrides,
})

describe('question-classifier/class-list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseEdgesInteractions.mockReturnValue({
      handleEdgeDeleteByDeleteBranch: vi.fn(),
    } as unknown as ReturnType<typeof useEdgesInteractions>)
  })

  it('adds, updates, collapses, and removes classes through the list actions', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const handleEdgeDeleteByDeleteBranch = vi.fn()
    mockUseEdgesInteractions.mockReturnValueOnce({
      handleEdgeDeleteByDeleteBranch,
    } as unknown as ReturnType<typeof useEdgesInteractions>)

    render(
      <ClassList
        nodeId="node-1"
        list={[createTopic(), createTopic({ id: 'topic-2', name: 'Refunds' })]}
        onChange={onChange}
        filterVar={() => true}
      />,
    )

    await user.click(screen.getAllByText('change-item')[0]!)
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'Billing questions updated' })]),
    )

    await user.click(screen.getAllByText('remove-item')[0]!)
    expect(handleEdgeDeleteByDeleteBranch).toHaveBeenCalledWith('node-1', 'topic-1')

    await user.click(
      screen.getByRole('button', { name: /workflow\.nodes\.questionClassifiers\.class/ }),
    )
    expect(
      screen.queryByText('workflow.nodes.questionClassifiers.addClass'),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /workflow\.nodes\.questionClassifiers\.class/ }),
    )
    await user.click(screen.getByText('workflow.nodes.questionClassifiers.addClass'))
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: '' })]),
    )
  })

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
    const { container } = render(
      <ClassList
        nodeId="node-1"
        list={[createTopic(), createTopic({ id: 'topic-2', name: 'Refunds' })]}
        onChange={vi.fn()}
        filterVar={() => true}
        readonly
      />,
    )

    expect(
      screen.queryByText('workflow.nodes.questionClassifiers.addClass'),
    ).not.toBeInTheDocument()
    expect(container.querySelector('.handle')).toBeNull()
  })
})
