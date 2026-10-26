import type { ListFilterNodeType } from '../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes } from 'reactflow'
import {
  createEdge,
  createNode,
  createStartNode,
} from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { ComparisonOperator } from '@/app/components/workflow/nodes/if-else/types'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import Node from '../node'
import Panel from '../panel'
import { OrderBy } from '../types'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'spec.schemaDefinitions.get': async () => [],
      'workspaces.current.tools.builtin.get': async () => [],
      'workspaces.current.tools.api.get': async () => [],
      'workspaces.current.tools.workflow.get': async () => [],
      'workspaces.current.tools.mcp.get': async () => [],
    }),
  }
})

const createData = (overrides: Partial<ListFilterNodeType> = {}): ListFilterNodeType => ({
  title: 'List Operator',
  desc: '',
  type: BlockEnum.ListFilter,
  variable: ['source', 'items'],
  var_type: VarType.arrayNumber,
  item_var_type: VarType.number,
  filter_by: {
    enabled: false,
    conditions: [{ key: '', comparison_operator: ComparisonOperator.equal, value: '1' }],
  },
  extract_by: { enabled: true, serial: '1' },
  limit: { enabled: true, size: 10 },
  order_by: { enabled: true, key: '', value: OrderBy.ASC },
  ...overrides,
})

function LivePanel() {
  const node = useNodes<ListFilterNodeType>().find((node) => node.id === 'operator')
  if (!node) return null
  return (
    <>
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
      <output aria-label="Saved list configuration">{JSON.stringify(node.data)}</output>
    </>
  )
}
function renderPanel(data = createData(), readonly = false) {
  return renderWorkflowFlowComponent(<LivePanel />, {
    nodes: [
      data.var_type === VarType.arrayFile
        ? createStartNode({
            id: 'source',
            data: {
              variables: [
                {
                  variable: 'items',
                  label: 'Items',
                  type: InputVarType.multiFiles,
                  required: true,
                },
              ],
            },
          })
        : createNode({
            id: 'source',
            data: {
              type: BlockEnum.Code,
              title: 'Source',
              outputs: { items: { type: data.var_type } },
              variables: [],
              code: '',
              code_language: 'python3',
            },
          }),
      createNode({ id: 'operator', data }),
    ],
    edges: [createEdge({ source: 'source', target: 'operator' })],
    initialStoreState: { canvasReadOnly: readonly },
  })
}
const saved = (): ListFilterNodeType =>
  JSON.parse(screen.getByRole('status', { name: 'Saved list configuration' }).textContent!)

// The panel's switches currently have no accessible names. Their visible order is
// Filter, Extract, Limit, Order; use the role list until those controls are labelled.
const switches = () => screen.getAllByRole('switch')

// The rich-text input has no accessible name yet. Distinguish its public
// contenteditable contract from the variable picker's read-only text input.
const queryExtractEditor = () =>
  screen.queryAllByRole('textbox').find((element) => element.hasAttribute('contenteditable')) ??
  null
const extractEditor = () => queryExtractEditor()!

describe('list-operator path', () => {
  it('saves extract input edits to the canvas', async () => {
    const user = userEvent.setup()
    renderPanel()
    const input = extractEditor()
    await user.type(input, '2')
    expect(input).toHaveTextContent('12')
    expect(saved().extract_by).toEqual({ enabled: true, serial: '12' })
  })

  it('saves the chosen file sub-variable for ordering', async () => {
    const user = userEvent.setup()
    renderPanel(
      createData({
        var_type: VarType.arrayFile,
        item_var_type: VarType.file,
        extract_by: { enabled: false, serial: '' },
        order_by: { enabled: true, key: 'size', value: OrderBy.ASC },
      }),
    )
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'name' }))
    expect(saved().order_by).toEqual({ enabled: true, key: 'name', value: OrderBy.ASC })
    expect(screen.getByRole('combobox')).toHaveTextContent('name')
  })

  it('saves the limit size and retains it across disabling and enabling the limit', async () => {
    const user = userEvent.setup()
    renderPanel()
    screen.getByRole('slider', { name: 'workflowLogic.nodes.listFilter.limit' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(saved().limit).toEqual({ enabled: true, size: 11 })
    await user.click(switches()[2]!)
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(saved().limit).toEqual({ enabled: false, size: 11 })
    await user.click(switches()[2]!)
    expect(screen.getByRole('spinbutton')).toHaveValue(11)
    expect(saved().limit).toEqual({ enabled: true, size: 11 })
  })

  it('keeps extract and limit data unchanged in read-only mode', async () => {
    const user = userEvent.setup()
    const data = createData()
    renderPanel(data, true)
    expect(screen.getByRole('spinbutton')).toBeDisabled()
    for (const toggle of switches()) expect(toggle).toHaveAttribute('aria-disabled', 'true')
    await user.click(switches()[2]!)
    await user.type(screen.getByRole('spinbutton'), '2')
    expect(saved()).toMatchObject(data)
    expect(extractEditor()).toHaveAttribute('contenteditable', 'false')
  })

  it('should render the selected input variable in the node preview', () => {
    renderWorkflowFlowComponent(
      <Node id="node-2" data={createData({ variable: ['node-1', 'items'] })} />,
      {
        nodes: [
          {
            id: 'node-1',
            position: { x: 0, y: 0 },
            data: { type: BlockEnum.Answer, title: 'Answer', desc: '' },
          },
        ],
        edges: [],
      },
    )

    expect(screen.getByText('Answer')).toBeInTheDocument()
    expect(screen.getByText('items')).toBeInTheDocument()
  })

  it('should resolve system variables through the start node and return null without a variable', () => {
    const { rerender } = renderWorkflowFlowComponent(
      <Node id="node-2" data={createData({ variable: ['sys', 'files'] })} />,
      {
        nodes: [
          {
            id: 'start',
            position: { x: 0, y: 0 },
            data: { type: BlockEnum.Start, title: 'Start', desc: '' },
          },
        ],
        edges: [],
      },
    )

    expect(screen.getByText('Start')).toBeInTheDocument()

    rerender(<Node id="node-2" data={createData({ variable: [] })} />)

    expect(screen.queryByText('workflow.nodes.listFilter.inputVar')).not.toBeInTheDocument()
    expect(screen.queryByText('Start')).not.toBeInTheDocument()
  })

  it('hides disabled controls and enables numeric ordering without sub-variable controls', async () => {
    const user = userEvent.setup()
    renderPanel(
      createData({
        extract_by: { enabled: false, serial: '' },
        order_by: { enabled: false, key: '', value: OrderBy.ASC },
      }),
    )
    expect(queryExtractEditor()).not.toBeInTheDocument()
    expect(screen.queryByText('workflowLogic.nodes.listFilter.asc')).not.toBeInTheDocument()
    await user.click(switches()[3]!)
    expect(screen.getByText('workflowLogic.nodes.listFilter.asc')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(saved().order_by).toEqual({ enabled: true, key: '', value: OrderBy.ASC })
  })
})
