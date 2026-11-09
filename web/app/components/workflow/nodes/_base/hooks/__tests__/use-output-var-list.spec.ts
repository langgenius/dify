import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { VarInInspect } from '@/types/workflow'
import { act } from '@testing-library/react'
import { useState } from 'react'
import { useNodes, useStoreApi } from 'reactflow'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { InspectVarsProvider } from '@/app/components/workflow/__tests__/inspect-vars-provider'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import useNodeCrud from '../use-node-crud'
import useOutputVarList from '../use-output-var-list'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.workflows.draft.variables.byVariableId.delete': async () => ({}),
      'apps.byAppId.workflows.draft.variables.byVariableId.patch': async () => ({}),
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.tools.builtin.get': async () => [],
      'workspaces.current.tools.api.get': async () => [],
      'workspaces.current.tools.workflow.get': async () => [],
      'workspaces.current.tools.mcp.get': async () => [],
    }),
  }
})

const createPayload = (overrides: Partial<CodeNodeType> = {}): CodeNodeType => ({
  title: 'Code',
  desc: '',
  type: BlockEnum.Code,
  code: 'def main():\n    return "ok"',
  code_language: CodeLanguage.python3,
  variables: [],
  outputs: {
    primary: { type: VarType.string, children: null },
    secondary: { type: VarType.number, children: null },
  },
  ...overrides,
})

const inspected = (name: string, type: VarType): VarInInspect => ({
  id: `inspect-${name}`,
  type: 'node',
  name,
  description: '',
  selector: ['code-node', name],
  value_type: type,
  value: type === VarType.string ? 'cached' : 7,
  edited: false,
  visible: true,
  is_truncated: false,
  full_content: { size_bytes: 0, download_url: '' },
})

function setup(payload = createPayload(), referenced = '', orders = Object.keys(payload.outputs)) {
  return renderWorkflowCanvasHook(
    () => {
      const inputs = useNodes<CodeNodeType>().find((node) => node.id === 'code-node')!.data
      const { setInputs } = useNodeCrud('code-node', inputs)
      const [outputKeyOrders, setOutputKeyOrders] = useState(orders)
      return {
        ...useOutputVarList({
          id: 'code-node',
          inputs,
          setInputs,
          outputKeyOrders,
          onOutputKeyOrdersChange: setOutputKeyOrders,
        }),
        inputs,
        outputKeyOrders,
        flow: useStoreApi(),
      }
    },
    {
      wrapper: InspectVarsProvider,
      nodes: [
        createNode({ id: 'code-node', data: payload }),
        createNode({
          id: 'consumer',
          data: createPayload({
            variables: referenced
              ? [{ variable: 'input', value_selector: ['code-node', referenced] }]
              : [],
          }),
        }),
      ],
      edges: [createEdge({ source: 'code-node', target: 'consumer' })],
      initialStoreState: {
        nodesWithInspectVars: [
          {
            nodeId: 'code-node',
            nodeType: BlockEnum.Code,
            title: 'Code',
            nodePayload: payload,
            vars: [inspected('primary', VarType.string), inspected('secondary', VarType.number)],
          },
        ],
      },
    },
  )
}
const fallbacks: CodeNodeType['default_value'] = [
  { key: 'primary', type: VarType.string, value: 'sentinel' },
  { key: 'secondary', type: VarType.number, value: 7 },
]
afterEach(() => vi.useRealTimers())

it.each([
  { index: 0, name: 'primary', remaining: 'secondary' },
  { index: 1, name: 'secondary', remaining: 'primary' },
])('removes referenced $name only after confirmation', async ({ index, name, remaining }) => {
  const { result, store } = setup(createPayload(), name)
  await act(async () => result.current.handleRemoveVariable(index))
  expect(result.current.isShowRemoveVarConfirm).toBe(true)
  expect(result.current.inputs.outputs).toEqual(createPayload().outputs)
  expect(store.getState().nodesWithInspectVars[0]?.vars).toHaveLength(2)
  await act(async () => result.current.onRemoveVarConfirm())
  expect(result.current.isShowRemoveVarConfirm).toBe(false)
  expect(Object.keys(result.current.inputs.outputs)).toEqual([remaining])
  expect(result.current.outputKeyOrders).toEqual([remaining])
  expect(
    result.current.flow
      .getState()
      .getNodes()
      .find((node) => node.id === 'consumer')?.data.variables,
  ).toEqual([{ variable: 'input', value_selector: [] }])
  expect(store.getState().nodesWithInspectVars[0]?.vars.map((variable) => variable.name)).toEqual([
    remaining,
  ])
})

it('removes an unused output and its inspected value immediately', async () => {
  const { result, store } = setup()
  await act(async () => result.current.handleRemoveVariable(0))
  expect(result.current.isShowRemoveVarConfirm).toBe(false)
  expect(result.current.inputs.outputs).toEqual({
    secondary: { type: VarType.number, children: null },
  })
  expect(result.current.outputKeyOrders).toEqual(['secondary'])
  expect(store.getState().nodesWithInspectVars[0]?.vars).toEqual([
    inspected('secondary', VarType.number),
  ])
})

it('preserves the output, inspected values and downstream reference on cancellation', async () => {
  const { result, store } = setup(createPayload(), 'primary')
  await act(async () => result.current.handleRemoveVariable(0))
  act(() => result.current.hideRemoveVarConfirm())
  expect(result.current.isShowRemoveVarConfirm).toBe(false)
  expect(result.current.inputs.outputs).toEqual(createPayload().outputs)
  expect(result.current.outputKeyOrders).toEqual(['primary', 'secondary'])
  expect(store.getState().nodesWithInspectVars[0]?.vars).toHaveLength(2)
  expect(
    result.current.flow
      .getState()
      .getNodes()
      .find((node) => node.id === 'consumer')?.data.variables,
  ).toEqual([{ variable: 'input', value_selector: ['code-node', 'primary'] }])
})

it('keeps the output and inspected value while another row has the same name', async () => {
  const { result, store } = setup(
    createPayload({ outputs: { primary: { type: VarType.string, children: null } } }),
    'primary',
    ['primary', 'primary'],
  )
  await act(async () => result.current.handleRemoveVariable(0))
  await act(async () => result.current.onRemoveVarConfirm())
  expect(result.current.outputKeyOrders).toEqual(['primary'])
  expect(result.current.inputs.outputs).toEqual({
    primary: { type: VarType.string, children: null },
  })
  expect(store.getState().nodesWithInspectVars[0]?.vars).toContainEqual(
    inspected('primary', VarType.string),
  )
})

it.each([true, false])(
  'retains configured fallbacks after removal (referenced: %s)',
  async (referenced) => {
    const { result } = setup(
      createPayload({ error_strategy: ErrorHandleTypeEnum.defaultValue, default_value: fallbacks }),
      referenced ? 'secondary' : '',
    )
    await act(async () => result.current.handleRemoveVariable(1))
    if (referenced) await act(async () => result.current.onRemoveVarConfirm())
    expect(result.current.inputs.default_value).toEqual([fallbacks[0]])
  },
)

it('creates the remaining fallback when none was configured', async () => {
  const { result } = setup(
    createPayload({ error_strategy: ErrorHandleTypeEnum.defaultValue }),
    'secondary',
  )
  await act(async () => result.current.handleRemoveVariable(1))
  await act(async () => result.current.onRemoveVarConfirm())
  expect(result.current.inputs.default_value).toEqual([
    { key: 'primary', type: VarType.string, value: '' },
  ])
})

it('preserves existing fallbacks when adding an output', () => {
  const { result } = setup(
    createPayload({ error_strategy: ErrorHandleTypeEnum.defaultValue, default_value: fallbacks }),
  )
  act(() => result.current.handleAddVariable())
  expect(result.current.outputKeyOrders).toEqual(['primary', 'secondary', 'var_3'])
  expect(result.current.inputs.default_value).toEqual([
    ...fallbacks,
    { key: 'var_3', type: VarType.string, value: '' },
  ])
})

it('renames the output, fallback and downstream reference together', async () => {
  vi.useFakeTimers()
  const { result } = setup(
    createPayload({ error_strategy: ErrorHandleTypeEnum.defaultValue, default_value: fallbacks }),
    'primary',
  )
  act(() =>
    result.current.handleVarsChange(
      {
        renamed: { type: VarType.string, children: null },
        secondary: { type: VarType.number, children: null },
      },
      0,
      'renamed',
    ),
  )
  expect(result.current.outputKeyOrders).toEqual(['renamed', 'secondary'])
  expect(result.current.inputs.default_value).toEqual([
    { ...fallbacks[0], key: 'renamed' },
    fallbacks[1],
  ])
  expect(
    result.current.flow
      .getState()
      .getNodes()
      .find((node) => node.id === 'consumer')?.data.variables,
  ).toEqual([{ variable: 'input', value_selector: ['code-node', 'renamed'] }])
  await act(async () => vi.advanceTimersByTimeAsync(501))
})

it('resets only the changed output fallback and stale inspected value', async () => {
  const { result, store } = setup(
    createPayload({ error_strategy: ErrorHandleTypeEnum.defaultValue, default_value: fallbacks }),
  )
  await act(async () =>
    result.current.handleVarsChange({
      primary: { type: VarType.string, children: null },
      secondary: { type: VarType.string, children: null },
    }),
  )
  expect(result.current.inputs.default_value).toEqual([
    fallbacks[0],
    { key: 'secondary', type: VarType.string, value: '' },
  ])
  expect(store.getState().nodesWithInspectVars[0]?.vars).toEqual([
    inspected('primary', VarType.string),
  ])
})

it('leaves fallbacks alone under the failure-branch strategy', async () => {
  const { result } = setup(
    createPayload({
      error_strategy: ErrorHandleTypeEnum.failBranch,
      default_value: [fallbacks[0]!],
    }),
  )
  await act(async () => result.current.handleRemoveVariable(1))
  expect(result.current.inputs.default_value).toEqual([fallbacks[0]])
})

it('preserves inspected values when the output schema is unchanged', async () => {
  const { result, store } = setup()
  await act(async () => result.current.handleVarsChange(createPayload().outputs))
  expect(store.getState().nodesWithInspectVars[0]?.vars).toEqual([
    inspected('primary', VarType.string),
    inspected('secondary', VarType.number),
  ])
})
