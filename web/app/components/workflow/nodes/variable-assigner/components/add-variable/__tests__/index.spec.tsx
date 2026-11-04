import type { VariableAssignerNodeType } from '../../../types'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes } from 'reactflow'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import AddVariable from '../index'

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    canApplyLocalGraphMutation: () => true,
    setNodes: vi.fn(),
    setEdges: vi.fn(),
  },
}))

const availableVars: NodeOutPutVar[] = [
  {
    nodeId: 'node-source',
    title: 'Source Node',
    vars: [
      { variable: 'answer', type: VarType.string },
      { variable: 'second', type: VarType.string },
    ],
  },
]
function Assignments() {
  const nodes = useNodes()
  return (
    <output aria-label="Assignments">
      {JSON.stringify(nodes.find((node) => node.id === 'node-target')?.data)}
    </output>
  )
}
const readAssignments = () => JSON.parse(screen.getByLabelText('Assignments').textContent!)
function setup(grouped = false) {
  const data: VariableAssignerNodeType = {
    title: 'Variable Assigner',
    desc: '',
    type: BlockEnum.VariableAssigner,
    output_type: VarType.any,
    variables: [],
    advanced_settings: {
      group_enabled: grouped,
      groups: grouped
        ? [{ groupId: 'group-1', group_name: 'Group 1', output_type: VarType.any, variables: [] }]
        : [],
    },
  }
  renderWorkflowFlowComponent(
    <>
      <input aria-label="Outside" />
      <AddVariable
        availableVars={availableVars}
        variableAssignerNodeId="node-target"
        variableAssignerNodeData={data}
        handleId={grouped ? 'group-1' : undefined}
      />
      <Assignments />
    </>,
    { nodes: [createNode({ id: 'node-target', data })] },
  )
}

it('assigns the selected variable to the selected group and closes the popup', async () => {
  const user = userEvent.setup()
  setup(true)
  await user.click(
    screen.getByRole('button', { name: 'workflowLogic.nodes.variableAssigner.setAssignVariable' }),
  )
  await user.click(screen.getByText('answer'))
  await waitFor(() =>
    expect(readAssignments()).toMatchObject({
      variables: [],
      advanced_settings: {
        groups: [
          {
            groupId: 'group-1',
            output_type: VarType.string,
            variables: [['node-source', 'answer']],
          },
        ],
      },
    }),
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('assigns the keyboard choice to the node without handling outside keys', async () => {
  const user = userEvent.setup()
  setup()
  await user.click(
    screen.getByRole('button', { name: 'workflowLogic.nodes.variableAssigner.setAssignVariable' }),
  )
  await user.keyboard('{ArrowDown}{Enter}')
  await waitFor(() =>
    expect(readAssignments()).toMatchObject({
      output_type: VarType.string,
      variables: [['node-source', 'second']],
    }),
  )
  await user.click(screen.getByRole('textbox', { name: 'Outside' }))
  await user.keyboard('{ArrowDown}{Enter}')
  expect(readAssignments().variables).toEqual([['node-source', 'second']])
})
