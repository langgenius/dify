import type { ReactFlowInstance } from 'reactflow'
import type { LoopNodeType } from '../types'
import ReactFlow, { useNodes, useReactFlow } from 'reactflow'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowBrowserComponent } from '@/app/components/workflow/__tests__/workflow-browser-test-env'
import { BlockEnum, ErrorHandleMode, ValueType, VarType } from '@/app/components/workflow/types'
import Panel from '../panel'
import { LogicalOperator } from '../types'

// Each journey runs through the real panel and reads the loop variable from the node data,
// which is what the editor syncs as the workflow draft.
const renderLoopPanel = async () => {
  const data: LoopNodeType = {
    title: 'Loop',
    desc: '',
    type: BlockEnum.Loop,
    start_node_id: 'loop-start',
    loop_id: 'loop-node',
    logical_operator: LogicalOperator.and,
    break_conditions: [],
    loop_count: 3,
    error_handle_mode: ErrorHandleMode.Terminated,
    loop_variables: [
      {
        id: 'loop-variable',
        label: 'item',
        var_type: VarType.string,
        value_type: ValueType.constant,
        value: 'previous text',
      },
    ],
  }
  let flow: ReactFlowInstance<LoopNodeType>
  function LivePanel() {
    flow = useReactFlow<LoopNodeType>()
    const node = useNodes<LoopNodeType>().find((item) => item.id === 'loop-node')
    return node ? (
      <Panel
        id={node.id}
        data={node.data}
        panelProps={{
          getInputVars: () => [],
          toVarInputs: () => [],
          runInputData: {},
          runInputDataRef: { current: {} },
          setRunInputData: () => {},
          runResult: null,
        }}
      />
    ) : null
  }
  const screen = await renderWorkflowBrowserComponent(
    <>
      <ReactFlow defaultNodes={[createNode({ id: 'loop-node', data })]} />
      <LivePanel />
    </>,
    { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } },
  )
  const select = async (current: string, next: string) => {
    await screen.getByRole('combobox').filter({ hasText: current }).click()
    await screen.getByRole('option', { name: next }).click()
  }
  const savedVariable = () => flow.getNode('loop-node')!.data.loop_variables![0]
  return { select, savedVariable }
}

describe('Loop variable type and input mode', () => {
  it('saves an empty constant after the type changes', async () => {
    const { select, savedVariable } = await renderLoopPanel()

    await select('String', 'Number')

    await expect.poll(savedVariable).toEqual({
      id: 'loop-variable',
      label: 'item',
      var_type: VarType.number,
      value_type: ValueType.constant,
      value: '',
    })
  })

  it('saves an empty selector after the input mode changes to Variable', async () => {
    const { select, savedVariable } = await renderLoopPanel()

    await select('Constant', 'Variable')

    await expect.poll(savedVariable).toEqual({
      id: 'loop-variable',
      label: 'item',
      var_type: VarType.string,
      value_type: ValueType.variable,
      value: [],
    })
  })

  it('uses the current type when the input mode changes after the type did', async () => {
    const { select, savedVariable } = await renderLoopPanel()

    await select('String', 'Boolean')
    await select('Constant', 'Variable')
    await select('Variable', 'Constant')

    await expect.poll(savedVariable).toEqual({
      id: 'loop-variable',
      label: 'item',
      var_type: VarType.boolean,
      value_type: ValueType.constant,
      value: false,
    })
  })

  it('uses the current input mode when the type changes after the mode did', async () => {
    const { select, savedVariable } = await renderLoopPanel()

    await select('Constant', 'Variable')
    await select('String', 'Boolean')

    await expect.poll(savedVariable).toEqual({
      id: 'loop-variable',
      label: 'item',
      var_type: VarType.boolean,
      value_type: ValueType.variable,
      value: [],
    })
  })
})
