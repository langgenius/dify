import type { VariableAssignerNodeType } from '../../../variable-assigner/types'
import type { Node } from '@/app/components/workflow/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEdges, useNodes } from 'reactflow'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import AddVariablePopupWithPosition from '../add-variable-popup-with-position'

const availableVars = [
  {
    nodeId: 'source',
    title: 'Source',
    vars: [
      { variable: 'first', type: VarType.string },
      { variable: 'second', type: VarType.string },
    ],
  },
]

// AP14: branch traversal and variable collection are heavy collaborators with their own suites.
vi.mock('../../../../hooks/use-workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../hooks/use-workflow')>()),
  useWorkflow: () => ({ getBeforeNodesInSameBranch: () => [] }),
}))
vi.mock('../../../../hooks/use-workflow-variables', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../hooks/use-workflow-variables')>()),
  useWorkflowVariables: () => ({ getNodeAvailableVars: () => availableVars }),
}))

type CanvasNode = Pick<Node, 'id' | 'data'>
type CanvasEdge = { id: string; source: string; target: string }

function CanvasStateProbe() {
  const nodes = useNodes()
  const edges = useEdges()

  return (
    <>
      <output aria-label="Canvas node state">
        {JSON.stringify(nodes.map(({ id, data }) => ({ id, data })))}
      </output>
      <output aria-label="Canvas edge state">
        {JSON.stringify(edges.map(({ id, source, target }) => ({ id, source, target })))}
      </output>
    </>
  )
}

const readCanvasNodes = () =>
  JSON.parse(
    screen.getByRole('status', { name: 'Canvas node state' }).textContent ?? '[]',
  ) as CanvasNode[]
const readCanvasEdges = () =>
  JSON.parse(
    screen.getByRole('status', { name: 'Canvas edge state' }).textContent ?? '[]',
  ) as CanvasEdge[]
const readNodeData = (id: string) => readCanvasNodes().find((node) => node.id === id)!.data

const renderPopup = () => {
  const sourceData = {
    title: 'Source',
    desc: '',
    type: BlockEnum.TemplateTransform,
    _showAddVariablePopup: true,
    _holdAddVariablePopup: false,
  }
  const assignerData: VariableAssignerNodeType = {
    title: 'Assigner',
    desc: '',
    type: BlockEnum.VariableAssigner,
    variables: [],
    output_type: VarType.string,
    advanced_settings: {
      group_enabled: false,
      groups: [],
    },
    _showAddVariablePopup: true,
    _holdAddVariablePopup: false,
  }
  const edge = createEdge({
    id: 'source-to-assigner',
    source: 'source',
    target: 'assigner',
    sourceHandle: 'source',
    targetHandle: 'target',
    data: {
      sourceType: BlockEnum.TemplateTransform,
      targetType: BlockEnum.VariableAssigner,
    },
  })

  return renderWorkflowFlowComponent(
    <>
      <input aria-label="Outside" />
      <AddVariablePopupWithPosition nodeId="source" nodeData={sourceData} />
      <CanvasStateProbe />
    </>,
    {
      initialStoreState: {
        showAssignVariablePopup: {
          nodeId: 'source',
          nodeData: sourceData,
          variableAssignerNodeId: 'assigner',
          variableAssignerNodeData: assignerData,
          variableAssignerNodeHandleId: 'target',
          x: 0,
          y: 0,
        },
      },
      nodes: [
        createNode({ id: 'source', width: 240, height: 80, data: sourceData }),
        createNode({ id: 'assigner', width: 240, height: 80, data: assignerData }),
      ],
      edges: [edge],
      reactFlowProps: { 'aria-label': 'Workflow canvas', tabIndex: 0 },
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    },
  )
}

const expectSelectedVariable = async (variable: string) => {
  await waitFor(() => {
    expect(readNodeData('assigner')).toMatchObject({
      variables: [['source', variable]],
      output_type: VarType.string,
      _showAddVariablePopup: false,
      _holdAddVariablePopup: false,
    })
  })
}

it('selects a connection variable from the owning canvas and preserves its focus', async () => {
  const user = userEvent.setup()
  const { store } = renderPopup()

  screen.getByRole('textbox', { name: 'Outside' }).focus()
  await user.keyboard('{ArrowDown}{Enter}')
  expect(readNodeData('assigner')).toMatchObject({ variables: [] })
  expect(store.getState().showAssignVariablePopup).toBeDefined()

  const canvas = screen.getByLabelText('Workflow canvas')
  canvas.focus()
  await user.keyboard('{ArrowDown}{Enter}')

  await expectSelectedVariable('second')
  expect(canvas).toHaveFocus()
})

it('selects a connection variable by mouse and updates the real canvas state', async () => {
  const user = userEvent.setup()
  const { store } = renderPopup()

  await user.click(screen.getByText('first'))

  await expectSelectedVariable('first')
  expect(readNodeData('source')).toMatchObject({
    _showAddVariablePopup: false,
    _holdAddVariablePopup: false,
  })
  expect(readCanvasEdges()).toEqual([
    { id: 'source-to-assigner', source: 'source', target: 'assigner' },
  ])
  expect(store.getState().showAssignVariablePopup).toBeUndefined()
  expect(
    screen.queryByText('workflowLogic.nodes.variableAssigner.setAssignVariable'),
  ).not.toBeInTheDocument()
})

it('clears the popup and source-node flag when clicking away', async () => {
  const user = userEvent.setup()
  const { store } = renderPopup()

  await user.click(screen.getByRole('textbox', { name: 'Outside' }))

  await waitFor(() => {
    expect(readNodeData('source')).toMatchObject({ _showAddVariablePopup: false })
  })
  expect(readNodeData('assigner')).toMatchObject({ variables: [] })
  expect(store.getState().showAssignVariablePopup).toBeUndefined()
})
