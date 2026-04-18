import type { ReactNode } from 'react'
import type { LoopDurationMap, LoopVariableMap, NodeTracing } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import LoopResultPanel from '../loop-result-panel'

const mockCodeEditor = vi.hoisted(() => vi.fn())
const mockTracingPanel = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  __esModule: true,
  default: (props: { title: ReactNode, value: unknown }) => {
    mockCodeEditor(props)
    return (
      <section data-testid="code-editor">
        <div>{props.title}</div>
        <div>{JSON.stringify(props.value)}</div>
      </section>
    )
  },
}))

vi.mock('@/app/components/workflow/run/tracing-panel', () => ({
  __esModule: true,
  default: (props: { list: NodeTracing[], className?: string }) => {
    mockTracingPanel(props)
    return <div data-testid="tracing-panel">{props.list.length}</div>
  },
}))

const createNodeTracing = (id: string, overrides: Partial<NodeTracing> = {}): NodeTracing => ({
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

describe('LoopResultPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loop duration in the header, expands loop variables, renders tracing details, and calls onBack', () => {
    const onBack = vi.fn()
    const loopDurationMap: LoopDurationMap = { 0: 1.2 }
    const loopVariableMap: LoopVariableMap = { 0: { item: 'alpha' } }

    const { container } = render(
      <LoopResultPanel
        list={[[createNodeTracing('1')]]}
        onBack={onBack}
        loopDurationMap={loopDurationMap}
        loopVariableMap={loopVariableMap}
      />,
    )

    expect(screen.getByText('1.20s')).toBeInTheDocument()
    const expandArrow = container.querySelector('.transition-transform.duration-200')
    if (!expandArrow)
      throw new Error('Expected loop expand arrow to be rendered')
    expect(expandArrow).not.toHaveClass('rotate-90')

    fireEvent.click(screen.getByText('workflow.singleRun.loop 1'))

    expect(expandArrow).toHaveClass('rotate-90')
    expect(screen.getByTestId('code-editor')).toHaveTextContent('{"item":"alpha"}')
    expect(screen.getByTestId('tracing-panel')).toHaveTextContent('1')
    expect(mockCodeEditor).toHaveBeenCalledWith(expect.objectContaining({
      value: loopVariableMap[0],
    }))
    expect(mockTracingPanel).toHaveBeenCalledWith(expect.objectContaining({
      list: [expect.objectContaining({ title: 'Loop Step 1' })],
    }))

    fireEvent.click(screen.getByText('workflow.singleRun.back'))

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  describe('Loop Variable Resolution', () => {
    it('should read loop variables by the actual loop index when rows are compacted', () => {
      const loopVariableMap: LoopVariableMap = {
        2: { item: 'alpha' },
      }

      render(
        <LoopResultPanel
          list={[[
            createNodeTracing('loop-2-step-1', {
              execution_metadata: {
                total_tokens: 0,
                total_price: 0,
                currency: 'USD',
                loop_index: 2,
              },
            }),
          ]]}
          onBack={vi.fn()}
          loopVariableMap={loopVariableMap}
        />,
      )

      fireEvent.click(screen.getByText('workflow.singleRun.loop 1'))

      expect(screen.getByTestId('code-editor')).toHaveTextContent('{"item":"alpha"}')
      expect(mockCodeEditor).toHaveBeenCalledWith(expect.objectContaining({
        value: loopVariableMap[2],
      }))
    })

    it('should read loop variables by parallel run id when available', () => {
      const loopVariableMap: LoopVariableMap = {
        'parallel-1': { item: 'beta' },
      }

      render(
        <LoopResultPanel
          list={[[
            createNodeTracing('parallel-step-1', {
              execution_metadata: {
                total_tokens: 0,
                total_price: 0,
                currency: 'USD',
                loop_index: 0,
                parallel_mode_run_id: 'parallel-1',
              },
            }),
          ]]}
          onBack={vi.fn()}
          loopVariableMap={loopVariableMap}
        />,
      )

      fireEvent.click(screen.getByText('workflow.singleRun.loop 1'))

      expect(screen.getByTestId('code-editor')).toHaveTextContent('{"item":"beta"}')
      expect(mockCodeEditor).toHaveBeenCalledWith(expect.objectContaining({
        value: loopVariableMap['parallel-1'],
      }))
    })
  })
})
