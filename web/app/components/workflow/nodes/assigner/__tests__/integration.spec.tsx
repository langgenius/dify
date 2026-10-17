import type { ComponentProps } from 'react'
import type { AssignerNodeOperation, AssignerNodeType } from '../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes, useReactFlow } from 'reactflow'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { fullWorkflowAccessControl } from '@/app/components/workflow/hooks-store'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import NodePreview from '../node'
import Panel from '../panel'
import { AssignerNodeInputType, WriteMode } from '../types'

// Monaco is a browser-owned editor; exercise the surrounding assignment flow with its input contract.
vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({
    value,
    onChange,
    readOnly,
  }: ComponentProps<
    typeof import('@/app/components/workflow/nodes/_base/components/editor/code-editor').default
  >) => (
    <textarea
      aria-label="JSON assignment"
      value={typeof value === 'object' ? JSON.stringify(value) : value}
      readOnly={readOnly}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}))

const operation = (overrides: Partial<AssignerNodeOperation> = {}): AssignerNodeOperation => ({
  variable_selector: ['conversation', 'greeting'],
  input_type: AssignerNodeInputType.constant,
  operation: WriteMode.set,
  value: 'hello',
  ...overrides,
})
const data = (items: AssignerNodeOperation[]): AssignerNodeType => ({
  title: 'Assigner',
  desc: '',
  type: BlockEnum.VariableAssigner,
  version: '2',
  items,
})
const renderPanel = (items = [operation()], readOnly = false) => {
  const { queryClient } = createConsoleQueryWrapper()
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  let readData: () => AssignerNodeType
  const LivePanel = () => {
    const current = useNodes<AssignerNodeType>().find((node) => node.id === 'assigner')
    const flow = useReactFlow<AssignerNodeType>()
    readData = () => flow.getNode('assigner')!.data
    return current ? (
      <Panel
        panelProps={{
          getInputVars: () => [],
          toVarInputs: () => [],
          runInputData: {},
          runInputDataRef: { current: {} },
          setRunInputData: () => {},
          runResult: null,
        }}
        id="assigner"
        data={current.data}
      />
    ) : null
  }
  const view = renderWorkflowFlowComponent(<LivePanel />, {
    queryClient,
    resource: { kind: 'app', appId: 'app-1', mode: 'advanced-chat' },
    hooksStoreProps: { accessControl: { ...fullWorkflowAccessControl, canEdit: !readOnly } },
    initialStoreState: {
      conversationVariables: [
        {
          id: 'greeting',
          name: 'greeting',
          description: '',
          value_type: ChatVarType.String,
          value: 'hello',
        },
        { id: 'count', name: 'count', description: '', value_type: ChatVarType.Number, value: 3 },
        {
          id: 'ready',
          name: 'ready',
          description: '',
          value_type: ChatVarType.Boolean,
          value: false,
        },
        {
          id: 'settings',
          name: 'settings',
          description: '',
          value_type: ChatVarType.Object,
          value: { a: 1 },
        },
      ],
    },
    nodes: [
      createNode({ id: 'start', data: { type: BlockEnum.Start, variables: [] } }),
      createNode({
        id: 'source',
        data: {
          title: 'Source',
          type: BlockEnum.Code,
          outputs: { text: { type: 'string' }, count: { type: 'number' } },
        },
      }),
      createNode({ id: 'assigner', data: data(items) }),
    ],
    edges: [
      createEdge({ source: 'start', target: 'source' }),
      createEdge({ source: 'source', target: 'assigner' }),
    ],
  })
  return { ...view, getData: () => readData() }
}
const operationName = (mode: WriteMode) => `workflowLogic.nodes.assigner.operations.${mode}`

describe('Assigner panel integration', () => {
  it('adds and removes operations in the actual workflow graph', async () => {
    const user = userEvent.setup()
    const { getData } = renderPanel([])
    expect(screen.getByText('workflowLogic.nodes.assigner.noVarTip')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
    expect(getData().version).toBe('2')
    expect(getData().items).toHaveLength(1)
    expect(getData().items[0]?.variable_selector).toEqual([])
    expect(
      screen.getByText('workflowLogic.nodes.assigner.selectAssignedVariable'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(getData().items).toEqual([])
    expect(screen.getByText('workflowLogic.nodes.assigner.noVarTip')).toBeInTheDocument()
  })

  it('persists string edits and clears the previous constant when changing operation', async () => {
    const user = userEvent.setup()
    const { getData } = renderPanel()
    const input = screen.getByRole('textbox', { name: 'conversation.greeting' })
    await user.clear(input)
    await user.type(input, 'Updated greeting')
    expect(getData().items[0]).toMatchObject({
      value: 'Updated greeting',
      input_type: AssignerNodeInputType.constant,
    })
    await user.click(screen.getByRole('button', { name: operationName(WriteMode.set) }))
    await user.click(screen.getByRole('menuitemradio', { name: operationName(WriteMode.clear) }))
    expect(getData().items[0]).toMatchObject({
      operation: WriteMode.clear,
      value: [],
      input_type: AssignerNodeInputType.variable,
    })
    expect(screen.queryByRole('textbox', { name: 'conversation.greeting' })).not.toBeInTheDocument()
  })

  it('chooses a numeric operation and persists numeric rather than string input', async () => {
    const user = userEvent.setup()
    const { getData } = renderPanel([
      operation({ variable_selector: ['conversation', 'count'], value: 3 }),
    ])
    await user.click(screen.getByRole('button', { name: operationName(WriteMode.set) }))
    await user.click(
      screen.getByRole('menuitemradio', { name: operationName(WriteMode.increment) }),
    )
    const input = screen.getByRole('textbox', { name: 'conversation.count' })
    await user.clear(input)
    await user.type(input, '5')
    await user.tab()
    expect(getData().items[0]).toMatchObject({
      operation: WriteMode.increment,
      value: 5,
      input_type: AssignerNodeInputType.constant,
    })
  })

  it('changes a boolean using the real option controls', async () => {
    const { getData } = renderPanel([
      operation({ variable_selector: ['conversation', 'ready'], value: false }),
    ])
    await userEvent.setup().click(screen.getByRole('button', { name: 'True' }))
    expect(getData().items[0]?.value).toBe(true)
  })

  it('persists the JSON editor result', async () => {
    const user = userEvent.setup()
    const { getData } = renderPanel([
      operation({ variable_selector: ['conversation', 'settings'], value: '{"a":1}' }),
    ])
    const editor = screen.getByRole('textbox', { name: 'JSON assignment' })
    await user.clear(editor)
    await user.paste('{"a":2}')
    expect(getData().items[0]?.value).toBe('{"a":2}')
  })

  it('prevents adding, removing, changing operation, or editing constants without edit access', async () => {
    const user = userEvent.setup()
    const initial = [
      operation(),
      operation({ variable_selector: ['conversation', 'ready'], value: false }),
    ]
    const { getData } = renderPanel(initial, true)
    const add = screen.getByRole('button', { name: 'common.operation.add' })
    expect(add).toBeDisabled()
    await user.click(add)
    for (const remove of screen.getAllByRole('button', { name: 'common.operation.remove' })) {
      expect(remove).toBeDisabled()
      await user.click(remove)
    }
    for (const selector of screen.getAllByRole('button', { name: operationName(WriteMode.set) })) {
      expect(selector).toBeDisabled()
      await user.click(selector)
    }
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: 'conversation.greeting' })
    expect(input).toHaveAttribute('readonly')
    await user.type(input, 'changed')
    const trueOption = screen.getByRole('button', { name: 'True' })
    expect(trueOption).toBeDisabled()
    await user.click(trueOption)
    expect(getData().items).toEqual(initial)
  })
})

describe('Assigner node previews', () => {
  it('shows unset operations and resolves the actual variable label and operation', async () => {
    const view = renderWorkflowFlowComponent(<NodePreview id="assigner" data={data([])} />, {
      nodes: [createNode({ id: 'source', data: { title: 'Source', type: BlockEnum.Code } })],
    })
    expect(screen.getByText('workflowLogic.nodes.assigner.varNotSet')).toBeInTheDocument()
    view.rerender(
      <NodePreview
        id="assigner"
        data={data([
          operation({ variable_selector: ['source', 'count'], operation: WriteMode.overwrite }),
        ])}
      />,
    )
    await waitFor(() => expect(screen.getByText('Source')).toBeInTheDocument())
    expect(screen.getByText('count')).toBeInTheDocument()
    expect(screen.getByText(operationName(WriteMode.overwrite))).toBeInTheDocument()
  })

  it('supports legacy selectors without a version or items list', () => {
    const legacy = {
      title: 'Legacy',
      desc: '',
      type: BlockEnum.VariableAssigner,
      assigned_variable_selector: ['sys', 'query'],
      write_mode: WriteMode.append,
    } as unknown as AssignerNodeType
    const view = renderWorkflowFlowComponent(<NodePreview id="assigner" data={legacy} />, {
      nodes: [createNode({ id: 'start', data: { title: 'Start', type: BlockEnum.Start } })],
    })
    expect(screen.getByText('Start')).toBeInTheDocument()
    expect(screen.getByText('query')).toBeInTheDocument()
    expect(screen.getByText(operationName(WriteMode.append))).toBeInTheDocument()
    view.rerender(
      <NodePreview
        id="assigner"
        data={{ ...legacy, assigned_variable_selector: [] } as unknown as AssignerNodeType}
      />,
    )
    expect(screen.queryByText(operationName(WriteMode.append))).not.toBeInTheDocument()
  })
})
