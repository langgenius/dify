import type { ReactNode } from 'react'
import type { LoopVariableMap, NodeTracing } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum } from '../../../types'
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

const createNodeTracing = (id: string, executionMetadata?: NonNullable<NodeTracing['execution_metadata']>): NodeTracing => ({
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
  execution_metadata: executionMetadata,
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
})

describe('LoopResultPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Loop variables should be resolved by the actual run key, not the rendered row position.
  describe('Loop Variable Resolution', () => {
    it('should read loop variables by the actual loop index when rows are compacted', () => {
      const loopVariableMap: LoopVariableMap = {
        2: { item: 'alpha' },
      }

      render(
        <LoopResultPanel
          list={[[
            createNodeTracing('loop-2-step-1', {
              total_tokens: 0,
              total_price: 0,
              currency: 'USD',
              loop_index: 2,
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
              total_tokens: 0,
              total_price: 0,
              currency: 'USD',
              parallel_mode_run_id: 'parallel-1',
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
