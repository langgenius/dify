import type { ListFilterNodeType } from '../types'
import { screen } from '@testing-library/react'
import { createNode, createStartNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import Node from '../node'
import { OrderBy } from '../types'

const createData = (overrides: Partial<ListFilterNodeType> = {}): ListFilterNodeType => ({
  title: 'List Operator',
  desc: '',
  type: BlockEnum.ListFilter,
  variable: ['answer-node', 'items'],
  var_type: VarType.arrayString,
  item_var_type: VarType.string,
  filter_by: {
    enabled: true,
    conditions: [
      {
        key: 'name',
        comparison_operator: 'contains',
        value: '',
      },
    ],
  },
  extract_by: {
    enabled: false,
    serial: '',
  },
  order_by: {
    enabled: true,
    key: 'name',
    value: OrderBy.ASC,
  },
  limit: {
    enabled: true,
    size: 10,
  },
  ...overrides,
})

const renderNode = (data: ListFilterNodeType) =>
  renderWorkflowFlowComponent(<Node id="list-node" data={data} />, {
    nodes: [
      createNode({ id: 'answer-node', data: { title: 'Answer', type: BlockEnum.Answer } }),
      createStartNode({ id: 'start-node' }),
    ],
    edges: [],
  })

it.each([
  [['answer-node', 'items'], 'Answer', 'items'],
  [['sys', 'files'], 'Start', 'files'],
])('resolves %j to its source label', async (variable, source, name) => {
  renderNode(createData({ variable }))
  expect(await screen.findByText(source)).toBeInTheDocument()
  expect(screen.getByText(name)).toBeInTheDocument()
})

it('omits the input row when no variable is configured', () => {
  renderNode(createData({ variable: [] }))
  expect(screen.queryByText('workflow.nodes.listFilter.inputVar')).not.toBeInTheDocument()
})
