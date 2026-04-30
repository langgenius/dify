import type { NodeTracing } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import LoopResultPanel from '../loop-result-panel'

const mockTracingPanel = vi.fn()

vi.mock('../tracing-panel', () => ({
  default: ({
    list,
    className,
  }: {
    list: NodeTracing[]
    className?: string
  }) => {
    mockTracingPanel({ list, className })
    return <div data-testid="tracing-panel">{list.length}</div>
  },
}))

const createNodeTracing = (id: string): NodeTracing => ({
  id,
  index: 0,
  predecessor_node_id: '',
  node_id: `node-${id}`,
  node_type: BlockEnum.Code,
  title: `Node ${id}`,
  inputs: {},
  inputs_truncated: false,
  process_data: {},
  process_data_truncated: false,
  outputs: {},
  outputs_truncated: false,
  status: 'succeeded',
  error: '',
  elapsed_time: 0,
  metadata: {
    iterator_length: 0,
    iterator_index: 0,
    loop_length: 0,
    loop_index: 0,
  },
  created_at: 0,
  created_by: {
    id: 'user-1',
    name: 'Tester',
    email: 'tester@example.com',
  },
  finished_at: 0,
  execution_metadata: undefined,
})

describe('LoopResultPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show loop rows, expand tracing details, and handle back and close actions', () => {
    const onHide = vi.fn()
    const onBack = vi.fn()

    const { container } = render(
      <LoopResultPanel
        list={[
          [createNodeTracing('1')],
          [createNodeTracing('2'), createNodeTracing('3')],
        ]}
        onHide={onHide}
        onBack={onBack}
        noWrap
      />,
    )

    expect(screen.getByText('workflow.singleRun.testRunLoop')).toBeInTheDocument()
    const contentPanels = container.querySelectorAll('.transition-all.duration-200')
    expect(contentPanels[0]).toHaveClass('max-h-0')

    fireEvent.click(screen.getByText('workflow.singleRun.loop 1'))
    expect(contentPanels[0]).not.toHaveClass('max-h-0')
    expect(screen.getAllByTestId('tracing-panel')[0]).toHaveTextContent('1')
    expect(mockTracingPanel).toHaveBeenCalledWith({
      list: [expect.objectContaining({ id: '1' })],
      className: 'bg-background-section-burn',
    })

    fireEvent.click(screen.getByText('workflow.singleRun.back'))
    const closeTrigger = container.querySelector('.ml-2.shrink-0.cursor-pointer.p-1')
    if (!closeTrigger)
      throw new Error('Expected close trigger to be rendered')
    fireEvent.click(closeTrigger)

    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onHide).toHaveBeenCalledTimes(1)
  })

  it('should stop click propagation when rendered inside the overlay wrapper', () => {
    const parentClick = vi.fn()
    const { container } = render(
      <div onClick={parentClick}>
        <LoopResultPanel
          list={[[createNodeTracing('1')]]}
          onHide={vi.fn()}
          onBack={vi.fn()}
        />
      </div>,
    )

    const overlay = container.querySelector('.absolute.inset-0')
    if (!overlay)
      throw new Error('Expected overlay wrapper to be rendered')

    fireEvent.click(overlay)

    expect(parentClick).not.toHaveBeenCalled()
  })
})
