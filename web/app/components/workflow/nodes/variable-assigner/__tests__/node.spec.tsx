import type { VariableAssignerNodeType } from '../types'
import { screen } from '@testing-library/react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import Node from '../node'
import { renderAssigner as renderWorkflowFlowComponent } from './test-helpers'

const createData = (
  overrides: Partial<VariableAssignerNodeType> = {},
): VariableAssignerNodeType => ({
  title: 'Variable Assigner',
  desc: '',
  type: BlockEnum.VariableAssigner,
  output_type: VarType.string,
  variables: [['source-node', 'rootVar']],
  advanced_settings: {
    group_enabled: true,
    groups: [
      {
        groupId: 'group-1',
        group_name: 'Group1',
        output_type: VarType.string,
        variables: [['source-node', 'groupVar']],
      },
      {
        groupId: 'group-2',
        group_name: 'Group2',
        output_type: VarType.number,
        variables: [],
      },
    ],
  },
  ...overrides,
})

const baseNodeProps = {
  id: 'assigner-node',
  type: 'custom',
  selected: false,
  zIndex: 1,
  isConnectable: true,
  xPos: 0,
  yPos: 0,
  dragging: false,
  dragHandle: '.drag-handle',
}

const renderNode = (data: VariableAssignerNodeType) =>
  renderWorkflowFlowComponent(<Node {...baseNodeProps} data={data} />, {
    nodes: [
      createNode({ id: 'assigner-node', data }),
      createNode({
        id: 'source-node',
        data: {
          title: 'Source',
          type: BlockEnum.Code,
          outputs: {
            rootVar: { type: VarType.string },
            groupVar: { type: VarType.string },
          },
        },
      }),
    ],
    edges: [],
  })

it('renders each group with its own variables and shows an unset group', async () => {
  renderNode(createData())
  expect(await screen.findByText('Group1')).toBeInTheDocument()
  expect(screen.getByText('Group2')).toBeInTheDocument()
  expect(screen.getByText('groupVar')).toBeInTheDocument()
  expect(screen.queryByText('rootVar')).not.toBeInTheDocument()
  expect(screen.getByText('workflowLogic.nodes.variableAssigner.varNotSet')).toBeInTheDocument()
})

it('uses root variables when grouping is disabled', async () => {
  renderNode(createData({ advanced_settings: { group_enabled: false, groups: [] } }))
  expect(await screen.findByText('workflow.nodes.variableAssigner.title')).toBeInTheDocument()
  expect(screen.getByText('rootVar')).toBeInTheDocument()
  expect(screen.queryByText('Group1')).not.toBeInTheDocument()
  expect(screen.queryByText('groupVar')).not.toBeInTheDocument()
})
