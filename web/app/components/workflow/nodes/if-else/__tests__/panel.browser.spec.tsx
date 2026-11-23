import type { CaseItem, IfElseNodeType } from '../types'
import ReactFlow, { useNodes } from 'reactflow'
import { createEdge, createNode, createStartNode } from '../../../__tests__/fixtures'
import { renderWorkflowBrowserComponent } from '../../../__tests__/workflow-browser-test-env'
import { BlockEnum, InputVarType, VarType } from '../../../types'
import Panel from '../panel'
import { ComparisonOperator, LogicalOperator } from '../types'

function LivePanel() {
  const node = useNodes<IfElseNodeType>().find((node) => node.id === 'if-else')
  if (!node) return null

  return (
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
  )
}

const renderPanel = (cases: CaseItem[]) =>
  renderWorkflowBrowserComponent(
    <>
      <ReactFlow
        style={{ width: 400, height: 200 }}
        defaultNodes={[
          createStartNode({
            id: 'start',
            type: 'input',
            data: {
              variables: [
                {
                  variable: 'files',
                  label: 'Files',
                  type: InputVarType.multiFiles,
                  required: true,
                },
              ],
            },
          }),
          createNode({
            id: 'if-else',
            type: 'default',
            data: { type: BlockEnum.IfElse, cases },
          }),
        ]}
        defaultEdges={[createEdge({ source: 'start', target: 'if-else', type: 'default' })]}
      />
      <LivePanel />
    </>,
  )

it('lets an ELSE-only node add its first case without offering a sub-variable action', async () => {
  const screen = await renderPanel([])
  const addCase = screen.getByRole('button', { name: 'ELIF' })
  await expect.element(addCase).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'workflowLogic.nodes.ifElse.addSubVariable' }))
    .not.toBeInTheDocument()

  await addCase.click()

  await expect
    .element(screen.getByRole('button', { name: 'workflowLogic.nodes.ifElse.addCondition' }))
    .toBeVisible()
})

it('allows adding the first sub-variable to a file-list condition', async () => {
  const screen = await renderPanel([
    {
      case_id: 'true',
      logical_operator: LogicalOperator.and,
      conditions: [
        {
          id: 'file-condition',
          variable_selector: ['start', 'files'],
          varType: VarType.arrayFile,
          comparison_operator: ComparisonOperator.contains,
          value: '',
        },
      ],
    },
  ])

  await screen.getByRole('button', { name: 'workflowLogic.nodes.ifElse.addSubVariable' }).click()

  await expect.element(screen.getByText('common.placeholder.select')).toBeVisible()
})
