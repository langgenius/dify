import type { IterationNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes } from 'reactflow'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { ErrorHandleMode } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createNode } from '../../../__tests__/fixtures'
import { BlockEnum, VarType } from '../../../types'
import Node from '../node'
import Panel from '../panel'

vi.mock('@/app/notifications', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('../../iteration-start', () => ({
  IterationStartNodeDumb: () => <div>iteration-start-node</div>,
}))

// Variable selection has its own canvas integration; these scenarios edit parallel execution controls.
vi.mock('../../_base/components/variable/var-reference-picker', () => ({ default: () => null }))

const createData = (overrides: Partial<IterationNodeType> = {}): IterationNodeType => ({
  title: 'Iteration',
  desc: '',
  type: BlockEnum.Iteration,
  start_node_id: 'start-node',
  iterator_selector: ['node-1', 'items'],
  iterator_input_type: VarType.arrayString,
  output_selector: ['child-node', 'text'],
  output_type: VarType.arrayString,
  is_parallel: false,
  parallel_nums: 3,
  error_handle_mode: ErrorHandleMode.Terminated,
  flatten_output: false,
  _isShowTips: false,
  _children: [],
  ...overrides,
})

const panelProps: PanelProps = {
  getInputVars: vi.fn(() => []),
  toVarInputs: vi.fn(() => []),
  runInputData: {},
  runInputDataRef: { current: {} },
  setRunInputData: vi.fn(),
  runResult: null,
}

function IterationPanel() {
  const node = useNodes<IterationNodeType>().find((node) => node.id === 'iteration-node')
  if (!node) return null
  return (
    <>
      <Panel id={node.id} data={node.data} panelProps={panelProps} />
      <output aria-label="Saved parallel configuration">
        {JSON.stringify({ parallel: node.data.parallel_nums, policy: node.data.error_handle_mode })}
      </output>
    </>
  )
}

function renderIteration(data = createData(), readOnly = false, candidate = false) {
  const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '0.6.0' })
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  return renderWorkflowFlowComponent(
    candidate ? <Node id="iteration-node" data={data} /> : <IterationPanel />,
    {
      queryClient,
      nodes: [
        createNode({ id: 'iteration-node', data, width: 500, height: 400 }),
        createNode({
          id: 'start-node',
          parentId: 'iteration-node',
          data: {
            type: BlockEnum.IterationStart,
            isInIteration: true,
            iteration_id: 'iteration-node',
          },
        }),
      ],
      initialStoreState: { canvasReadOnly: readOnly },
      hooksStoreProps: { doSyncWorkflowDraft: async () => undefined },
    },
  )
}

const savedConfiguration = () =>
  JSON.parse(screen.getByRole('status', { name: 'Saved parallel configuration' }).textContent!)

describe('iteration path', () => {
  it('renders a candidate iteration and shows its parallel warning once', () => {
    renderIteration(
      createData({
        _isCandidate: true,
        _children: [{ nodeId: 'start-node', nodeType: BlockEnum.IterationStart }],
        is_parallel: true,
        _isShowTips: true,
      }),
      false,
      true,
    )
    expect(screen.getByText('iteration-start-node')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'workflow.common.addBlock' })).toBeInTheDocument()
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(
      'workflowLogic.nodes.iteration.answerNodeWarningDesc',
    )
  })

  it('saves numeric parallelism and the selected error policy on the canvas', async () => {
    const user = userEvent.setup()
    renderIteration(createData({ is_parallel: true }))
    const input = screen.getByRole('textbox', {
      name: 'workflowLogic.nodes.iteration.MaxParallelismTitle',
    })
    await user.clear(input)
    await user.type(input, '7')
    await user.click(screen.getByRole('combobox'))
    await user.click(
      screen.getByRole('option', {
        name: 'workflowLogic.nodes.iteration.ErrorMethod.continueOnError',
      }),
    )
    expect(savedConfiguration()).toEqual({ parallel: 7, policy: ErrorHandleMode.ContinueOnError })
    expect(input).toHaveValue('7')
  })

  it('hides parallel controls when parallel mode is disabled', () => {
    renderIteration()
    expect(
      screen.queryByRole('textbox', { name: 'workflowLogic.nodes.iteration.MaxParallelismTitle' }),
    ).not.toBeInTheDocument()
  })

  it('preserves the saved parallel count and restores it on blur after clearing the input', async () => {
    const user = userEvent.setup()
    renderIteration(createData({ is_parallel: true }))
    const input = screen.getByRole('textbox', {
      name: 'workflowLogic.nodes.iteration.MaxParallelismTitle',
    })
    await user.clear(input)
    await user.tab()
    expect(savedConfiguration()).toEqual({ parallel: 3, policy: ErrorHandleMode.Terminated })
    expect(input).toHaveValue('3')
  })

  it('disables parallel count controls on a readonly canvas', () => {
    renderIteration(createData({ is_parallel: true }), true)
    expect(
      screen.getByRole('textbox', { name: 'workflowLogic.nodes.iteration.MaxParallelismTitle' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('slider', { name: 'workflowLogic.nodes.iteration.MaxParallelismTitle' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Increment value' })).toBeDisabled()
  })
})
