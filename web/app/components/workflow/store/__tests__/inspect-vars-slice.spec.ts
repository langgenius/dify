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
    nodePayload: { title: `Node ${nodeId}`, desc: '', type: BlockEnum.Code } as NodeWithVar['nodePayload'],
    nodeType: BlockEnum.Code,
    title: `Node ${nodeId}`,
    vars,
    isValueFetched: false,
  }
}

describe('Inspect Vars Slice', () => {
  describe('setNodesWithInspectVars', () => {
    it('should replace the entire list', () => {
      const store = createStore()
      const nodes = [makeNodeWithVar('n1', [makeVar()])]
      store.getState().setNodesWithInspectVars(nodes)
      expect(store.getState().nodesWithInspectVars).toEqual(nodes)
    })
  })

  describe('deleteAllInspectVars', () => {
    it('should clear all nodes', () => {
      const store = createStore()
      store.getState().setNodesWithInspectVars([makeNodeWithVar('n1', [makeVar()])])
      store.getState().deleteAllInspectVars()
      expect(store.getState().nodesWithInspectVars).toEqual([])
    })
  })

  describe('setNodeInspectVars', () => {
    it('should update vars for a specific node and mark as fetched', () => {
      const store = createStore()
      const v1 = makeVar({ id: 'v1', name: 'a' })
      const v2 = makeVar({ id: 'v2', name: 'b' })
      store.getState().setNodesWithInspectVars([makeNodeWithVar('n1', [v1])])

      store.getState().setNodeInspectVars('n1', [v2])

      const node = store.getState().nodesWithInspectVars[0]
      expect(node!.vars).toEqual([v2])
      expect(node!.isValueFetched).toBe(true)
    })

    it('should not modify state when node is not found', () => {
      const store = createStore()
      store.getState().setNodesWithInspectVars([makeNodeWithVar('n1', [makeVar()])])

      store.getState().setNodeInspectVars('non-existent', [])

      expect(store.getState().nodesWithInspectVars[0]!.vars).toHaveLength(1)
    })
  })

  describe('deleteNodeInspectVars', () => {
    it('should remove the matching node', () => {
      const store = createStore()
      store.getState().setNodesWithInspectVars([
        makeNodeWithVar('n1', [makeVar()]),
        makeNodeWithVar('n2', [makeVar()]),
      ])

      store.getState().deleteNodeInspectVars('n1')

      expect(store.getState().nodesWithInspectVars).toHaveLength(1)
      expect(store.getState().nodesWithInspectVars[0]!.nodeId).toBe('n2')
    })
  })

  describe('setInspectVarValue', () => {
    it('should update the value and set edited=true', () => {
      const store = createStore()
      const v = makeVar({ id: 'v1', value: 'old', edited: false })
      store.getState().setNodesWithInspectVars([makeNodeWithVar('n1', [v])])

      store.getState().setInspectVarValue('n1', 'v1', 'new')

      const updated = store.getState().nodesWithInspectVars[0]!.vars[0]
      expect(updated!.value).toBe('new')
      expect(updated!.edited).toBe(true)
    })

    it('should not change state when var is not found', () => {
      const store = createStore()
      const v = makeVar({ id: 'v1', value: 'old' })
      store.getState().setNodesWithInspectVars([makeNodeWithVar('n1', [v])])

      store.getState().setInspectVarValue('n1', 'wrong-id', 'new')

      expect(store.getState().nodesWithInspectVars[0]!.vars[0]!.value).toBe('old')
    })

    it('should not change state when node is not found', () => {
      const store = createStore()
      const v = makeVar({ id: 'v1', value: 'old' })
      store.getState().setNodesWithInspectVars([makeNodeWithVar('n1', [v])])

      store.getState().setInspectVarValue('wrong-node', 'v1', 'new')

      expect(store.getState().nodesWithInspectVars[0]!.vars[0]!.value).toBe('old')
    })
  })

  describe('resetToLastRunVar', () => {
    it('should restore value and set edited=false', () => {
      const store = createStore()
      const v = makeVar({ id: 'v1', value: 'modified', edited: true })
      store.getState().setNodesWithInspectVars([makeNodeWithVar('n1', [v])])

      store.getState().resetToLastRunVar('n1', 'v1', 'original')

      const updated = store.getState().nodesWithInspectVars[0]!.vars[0]
      expect(updated!.value).toBe('original')
      expect(updated!.edited).toBe(false)
    })

    it('should not change state when node is not found', () => {
      const store = createStore()
      store.getState().setNodesWithInspectVars([makeNodeWithVar('n1', [makeVar()])])

      store.getState().resetToLastRunVar('wrong-node', 'v1', 'val')

      expect(store.getState().nodesWithInspectVars[0]!.vars[0]!.edited).toBe(false)
    })

    it('should not change state when var is not found', () => {
      const store = createStore()
      store.getState().setNodesWithInspectVars([makeNodeWithVar('n1', [makeVar({ id: 'v1', edited: true })])])

      store.getState().resetToLastRunVar('n1', 'wrong-var', 'val')

      expect(store.getState().nodesWithInspectVars[0]!.vars[0]!.edited).toBe(true)
    })
  })

  describe('renameInspectVarName', () => {
    it('should update name and selector', () => {
      const store = createStore()
      const v = makeVar({ id: 'v1', name: 'old_name', selector: ['n1', 'old_name'] })
      store.getState().setNodesWithInspectVars([makeNodeWithVar('n1', [v])])

      store.getState().renameInspectVarName('n1', 'v1', ['n1', 'new_name'])

      const updated = store.getState().nodesWithInspectVars[0]!.vars[0]
      expect(updated!.name).toBe('new_name')
      expect(updated!.selector).toEqual(['n1', 'new_name'])
    })

    it('should not change state when node is not found', () => {
      const store = createStore()
      const v = makeVar({ id: 'v1', name: 'old' })
      store.getState().setNodesWithInspectVars([makeNodeWithVar('n1', [v])])

      store.getState().renameInspectVarName('wrong-node', 'v1', ['x', 'y'])

      expect(store.getState().nodesWithInspectVars[0]!.vars[0]!.name).toBe('old')
    })

    it('should not change state when var is not found', () => {
      const store = createStore()
      const v = makeVar({ id: 'v1', name: 'old' })
      store.getState().setNodesWithInspectVars([makeNodeWithVar('n1', [v])])

      store.getState().renameInspectVarName('n1', 'wrong-var', ['x', 'y'])

      expect(store.getState().nodesWithInspectVars[0]!.vars[0]!.name).toBe('old')
    })
  })

  describe('deleteInspectVar', () => {
    it('should remove the matching var from the node', () => {
      const store = createStore()
      const v1 = makeVar({ id: 'v1' })
      const v2 = makeVar({ id: 'v2' })
      store.getState().setNodesWithInspectVars([makeNodeWithVar('n1', [v1, v2])])

      store.getState().deleteInspectVar('n1', 'v1')

      const vars = store.getState().nodesWithInspectVars[0]!.vars
      expect(vars).toHaveLength(1)
      expect(vars[0]!.id).toBe('v2')
    })

    it('should not change state when var is not found', () => {
      const store = createStore()
      const v = makeVar({ id: 'v1' })
      store.getState().setNodesWithInspectVars([makeNodeWithVar('n1', [v])])

      store.getState().deleteInspectVar('n1', 'wrong-id')

      expect(store.getState().nodesWithInspectVars[0]!.vars).toHaveLength(1)
    })

    it('should not change state when node is not found', () => {
      const store = createStore()
      store.getState().setNodesWithInspectVars([makeNodeWithVar('n1', [makeVar()])])

      store.getState().deleteInspectVar('wrong-node', 'v1')

      expect(store.getState().nodesWithInspectVars[0]!.vars).toHaveLength(1)
    })
  })

  describe('currentFocusNodeId', () => {
    it('should update and clear focus node', () => {
      const store = createStore()
      store.getState().setCurrentFocusNodeId('n1')
      expect(store.getState().currentFocusNodeId).toBe('n1')

      store.getState().setCurrentFocusNodeId(null)
      expect(store.getState().currentFocusNodeId).toBeNull()
    })
  })
})
