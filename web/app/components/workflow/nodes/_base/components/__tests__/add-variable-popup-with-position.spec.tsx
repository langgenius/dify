import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReactFlow, { ReactFlowProvider } from 'reactflow'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import AddVariablePopupWithPosition from '../add-variable-popup-with-position'

const assignVariable = vi.fn()
const workflowState = {
  showAssignVariablePopup: {
    nodeId: 'source',
    nodeData: { type: BlockEnum.TemplateTransform },
    variableAssignerNodeId: 'assigner',
    variableAssignerNodeData: { output_type: VarType.string },
    variableAssignerNodeHandleId: 'target',
    x: 0,
    y: 0,
  },
  setShowAssignVariablePopup: vi.fn(),
}
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

vi.mock('../../../../store', () => ({
  useStore: (selector: (state: typeof workflowState) => unknown) => selector(workflowState),
}))
vi.mock('../../../../hooks/use-node-data-update', () => ({
  useNodeDataUpdate: () => ({ handleNodeDataUpdate: vi.fn() }),
}))
vi.mock('../../../../hooks/use-workflow', () => ({
  useIsChatMode: () => false,
  useWorkflow: () => ({ getBeforeNodesInSameBranch: () => [] }),
}))
vi.mock('../../../../hooks/use-workflow-variables', () => ({
  useWorkflowVariables: () => ({ getNodeAvailableVars: () => availableVars }),
}))
vi.mock('../../../variable-assigner/hooks', () => ({
  useVariableAssigner: () => ({ handleAddVariableInAddVariablePopupWithPosition: assignVariable }),
}))

it('selects a connection variable from the owning canvas and preserves its focus', async () => {
  const user = userEvent.setup()
  render(
    <>
      <input aria-label="Outside" />
      <ReactFlowProvider>
        <ReactFlow aria-label="Workflow canvas" tabIndex={0} nodes={[]} edges={[]}>
          <AddVariablePopupWithPosition nodeId="source" nodeData={{}} />
        </ReactFlow>
      </ReactFlowProvider>
    </>,
  )

  screen.getByRole('textbox', { name: 'Outside' }).focus()
  await user.keyboard('{ArrowDown}{Enter}')
  expect(assignVariable).not.toHaveBeenCalled()
  const canvas = screen.getByLabelText('Workflow canvas')
  canvas.focus()
  await user.keyboard('{ArrowDown}{Enter}')

  expect(assignVariable).toHaveBeenCalledWith(
    'source',
    'assigner',
    'target',
    ['source', 'second'],
    expect.objectContaining({ variable: 'second' }),
  )
  expect(canvas).toHaveFocus()
})
