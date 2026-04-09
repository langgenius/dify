import type { LoopDurationMap, LoopVariableMap, NodeTracing } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum, NodeRunningStatus } from '../../../types'
import LoopResultPanel from '../loop-result-panel'

const createTrace = (id: string, overrides: Partial<NodeTracing> = {}): NodeTracing => ({
  id,
  index: 0,
  predecessor_node_id: '',
  node_id: `node-${id}`,
  node_type: BlockEnum.Code,
  title: `Loop Step ${id}`,
  inputs: {},
  inputs_truncated: false,
  process_data: {},
  process_data_truncated: false,
  outputs: {},
  outputs_truncated: false,
  status: NodeRunningStatus.Succeeded,
  error: '',
  elapsed_time: 0.2,
  execution_metadata: {
    total_tokens: 0,
    total_price: 0,
    currency: 'USD',
    loop_index: 0,
  },
  metadata: {
    iterator_length: 0,
    iterator_index: 0,
    loop_length: 0,
    loop_index: 0,
  },
  created_at: 1710000000,
  created_by: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
  },
  finished_at: 1710000001,
  ...overrides,
})

describe('LoopResultPanel in loop-log', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loop duration in the header, expands loop variables, and calls onBack', () => {
    const onBack = vi.fn()
    const loopDurationMap: LoopDurationMap = { 0: 1.2 }
    const loopVariableMap: LoopVariableMap = { 0: { item: 'alpha' } }

    const { container } = render(
      <LoopResultPanel
        list={[[createTrace('1')]]}
        onBack={onBack}
        loopDurationMap={loopDurationMap}
        loopVariableMap={loopVariableMap}
      />,
    )

    expect(screen.getByText('1.20s')).toBeInTheDocument()
    expect((screen.getByTestId('monaco-editor') as HTMLTextAreaElement).value).toContain('alpha')
    const expandArrow = container.querySelector('.transition-transform.duration-200')
    if (!expandArrow)
      throw new Error('Expected loop expand arrow to be rendered')
    expect(expandArrow).not.toHaveClass('rotate-90')

    fireEvent.click(screen.getByText('workflow.singleRun.loop 1'))

    expect(expandArrow).toHaveClass('rotate-90')
    expect((screen.getByTestId('monaco-editor') as HTMLTextAreaElement).value).toContain('alpha')
    expect(screen.getByText('Loop Step 1')).toBeInTheDocument()

    fireEvent.click(screen.getByText('workflow.singleRun.back'))

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
