import type { NodeWithVar, VarInInspect } from '@/types/workflow'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { VarInInspectType } from '@/types/workflow'
import { createTestWorkflowStore } from '../../__tests__/workflow-test-env'

function createStore() {
  return createTestWorkflowStore()
}

function makeVar(overrides: Partial<VarInInspect> = {}): VarInInspect {
  return {
    id: 'var-1',
    name: 'output',
    type: VarInInspectType.node,
    description: '',
    selector: ['node-1', 'output'],
    value_type: VarType.string,
    value: 'hello',
    edited: false,
    visible: true,
    is_truncated: false,
    full_content: { size_bytes: 0, download_url: '' },
    ...overrides,
  }
}

function makeNodeWithVar(nodeId: string, vars: VarInInspect[]): NodeWithVar {
  return {
    nodeId,
    nodePayload: {
      title: `Node ${nodeId}`,
      desc: '',
      type: BlockEnum.Code,
    } as NodeWithVar['nodePayload'],
    nodeType: BlockEnum.Code,
    title: `Node ${nodeId}`,
    vars,
    isValueFetched: false,
  }
}

it('fetches and edits one node without changing its neighbors, then restores the last-run value', () => {
  const store = createStore()
  const neighbor = makeNodeWithVar('n2', [makeVar({ id: 'neighbor', value: 'untouched' })])
  const first = makeVar({ id: 'v1', value: 'initial', selector: ['n1', 'output'] })
  store.getState().setNodesWithInspectVars([makeNodeWithVar('n1', []), neighbor])
  store.getState().setNodeInspectVars('n1', [first])
  expect(store.getState().nodesWithInspectVars).toEqual([
    { ...makeNodeWithVar('n1', [first]), isValueFetched: true },
    neighbor,
  ])
  store.getState().setInspectVarValue('n1', 'v1', 'edited')
  expect(store.getState().nodesWithInspectVars[0]?.vars).toEqual([
    { ...first, value: 'edited', edited: true },
  ])
  store.getState().resetToLastRunVar('n1', 'v1', 'last run')
  expect(store.getState().nodesWithInspectVars[0]?.vars).toEqual([
    { ...first, value: 'last run', edited: false },
  ])
  expect(store.getState().nodesWithInspectVars[1]).toEqual(neighbor)
})

it('renames both the variable and selector, then deletes only the requested variable and node', () => {
  const store = createStore()
  const first = makeVar({ id: 'v1', selector: ['n1', 'output'] })
  const second = makeVar({ id: 'v2', name: 'other', selector: ['n1', 'other'] })
  const neighbor = makeNodeWithVar('n2', [makeVar({ id: 'v3' })])
  store.getState().setNodesWithInspectVars([makeNodeWithVar('n1', [first, second]), neighbor])
  store.getState().renameInspectVarName('n1', 'v1', ['n1', 'answer'])
  expect(store.getState().nodesWithInspectVars[0]?.vars).toEqual([
    { ...first, name: 'answer', selector: ['n1', 'answer'] },
    second,
  ])
  store.getState().deleteInspectVar('n1', 'v1')
  expect(store.getState().nodesWithInspectVars).toEqual([makeNodeWithVar('n1', [second]), neighbor])
  store.getState().deleteNodeInspectVars('n1')
  expect(store.getState().nodesWithInspectVars).toEqual([neighbor])
  store.getState().deleteAllInspectVars()
  expect(store.getState().nodesWithInspectVars).toEqual([])
})

it.each(['missing-node', 'missing-variable'])(
  'preserves all inspector data when the target is %s',
  (target) => {
    const store = createStore()
    const nodes = [makeNodeWithVar('n1', [makeVar({ id: 'v1', edited: true })])]
    store.getState().setNodesWithInspectVars(nodes)
    const nodeId = target === 'missing-node' ? 'absent' : 'n1'
    const variableId = target === 'missing-variable' ? 'absent' : 'v1'
    store.getState().setInspectVarValue(nodeId, variableId, 'changed')
    store.getState().resetToLastRunVar(nodeId, variableId, 'restored')
    store.getState().renameInspectVarName(nodeId, variableId, [nodeId, 'renamed'])
    store.getState().deleteInspectVar(nodeId, variableId)
    store.getState().setNodeInspectVars('absent', [])
    expect(store.getState().nodesWithInspectVars).toEqual(nodes)
  },
)
