import type { VariableAssignerNodeType } from '../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { createEdge, createNode } from '../../../__tests__/fixtures'
import { renderNodePanel } from '../../__tests__/render-node-panel'
import Panel from '../panel'

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

const source = createNode({
  id: 'source-node',
  data: {
    type: BlockEnum.Code,
    title: 'Source',
    outputs: { rootVar: { type: VarType.string }, groupVar: { type: VarType.string } },
  },
})
const renderPanel = (data = createData(), readOnly = false) =>
  renderNodePanel(Panel, data, {
    nodes: [source, createNode({ id: 'node', data })],
    edges: [createEdge({ source: source.id, target: 'node' })],
    initialStoreState: { canvasReadOnly: readOnly },
  })

describe('variable-assigner/panel', () => {
  it('adds aggregation groups and preserves the first group when aggregation is disabled', async () => {
    const user = userEvent.setup()
    const { data } = renderPanel()
    expect(screen.getByText('Group1')).toBeInTheDocument()
    expect(screen.getByText('Group2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'workflow.nodes.common.outputVars' }))
    expect(screen.getByText('Group1.output')).toBeInTheDocument()
    expect(screen.getByText('Group2.output')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'workflowLogic.nodes.variableAssigner.addGroup' }),
    )
    expect(data().advanced_settings?.groups).toEqual([
      ...createData().advanced_settings!.groups,
      expect.objectContaining({ group_name: 'Group3', output_type: VarType.any, variables: [] }),
    ])
    expect(screen.getByText('Group3')).toBeInTheDocument()
    await user.click(screen.getByRole('switch'))
    expect(data()).toMatchObject({
      advanced_settings: { group_enabled: false },
      variables: [['source-node', 'groupVar']],
      output_type: VarType.string,
    })
    expect(screen.queryByText('Group1.output')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'workflowLogic.nodes.variableAssigner.addGroup' }),
    ).not.toBeInTheDocument()
  })

  it('renders a single root group and hides output vars when aggregation is disabled', () => {
    renderPanel(createData({ advanced_settings: { group_enabled: false, groups: [] } }))
    expect(screen.getByText('rootVar')).toBeInTheDocument()
    expect(
      screen.getByText('workflowLogic.nodes.variableAssigner.aggregationGroup'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Group1.output')).not.toBeInTheDocument()
  })

  it('prevents adding or renaming groups in read-only mode', async () => {
    const user = userEvent.setup()
    const { data } = renderPanel(createData(), true)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.queryByRole('button', { name: 'workflowLogic.nodes.variableAssigner.addGroup' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByText('Group1'))
    expect(screen.queryByDisplayValue('Group1')).not.toBeInTheDocument()
    expect(data()).toMatchObject(createData())
  })

  it.each(['cancel', 'confirm'])(
    'handles %s when disabling groups would remove a referenced output',
    async (action) => {
      const user = userEvent.setup()
      const initial = createData()
      const consumer = createNode({
        id: 'consumer',
        data: {
          type: BlockEnum.TemplateTransform,
          variables: [{ variable: 'value', value_selector: ['node', 'Group2', 'output'] }],
          template: '{{ value }}',
        },
      })
      const { data, getNode } = renderNodePanel(Panel, initial, {
        nodes: [source, createNode({ id: 'node', data: initial }), consumer],
        edges: [
          createEdge({ source: source.id, target: 'node' }),
          createEdge({ source: 'node', target: 'consumer' }),
        ],
      })
      await user.click(screen.getByRole('switch'))
      expect(data().advanced_settings?.group_enabled).toBe(true)
      await user.click(screen.getByRole('button', { name: `common.operation.${action}` }))
      expect(data().advanced_settings?.group_enabled).toBe(action === 'cancel')
      expect(getNode('consumer')?.data.variables).toEqual([
        {
          variable: 'value',
          value_selector: action === 'confirm' ? [] : ['node', 'Group2', 'output'],
        },
      ])
      expect(
        screen.queryByRole('button', { name: 'common.operation.confirm' }),
      ).not.toBeInTheDocument()
    },
  )
})
