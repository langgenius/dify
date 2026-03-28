import { createEdge, createNode, resetFixtureCounters } from '../../__tests__/fixtures'
import { BlockEnum } from '../../types'
import {
  canRunBySingle,
  changeNodesAndEdgesId,
  getNodesConnectedSourceOrTargetHandleIdsMap,
  getValidTreeNodes,
  hasErrorHandleNode,
  isSupportCustomRunForm,
} from '../workflow'

beforeEach(() => {
  resetFixtureCounters()
})

describe('canRunBySingle', () => {
  const runnableTypes = [
    BlockEnum.LLM,
    BlockEnum.KnowledgeRetrieval,
    BlockEnum.Code,
    BlockEnum.TemplateTransform,
    BlockEnum.QuestionClassifier,
    BlockEnum.HttpRequest,
    BlockEnum.Tool,
    BlockEnum.ParameterExtractor,
    BlockEnum.Iteration,
    BlockEnum.Agent,
    BlockEnum.DocExtractor,
    BlockEnum.Loop,
    BlockEnum.Start,
    BlockEnum.IfElse,
    BlockEnum.VariableAggregator,
    BlockEnum.Assigner,
    BlockEnum.HumanInput,
    BlockEnum.DataSource,
    BlockEnum.TriggerSchedule,
    BlockEnum.TriggerWebhook,
    BlockEnum.TriggerPlugin,
  ]

  it.each(runnableTypes)('should return true for %s when not a child node', (type) => {
    expect(canRunBySingle(type, false)).toBe(true)
  })

  it('should return false for Assigner when it is a child node', () => {
    expect(canRunBySingle(BlockEnum.Assigner, true)).toBe(false)
  })

  it('should return true for LLM even as a child node', () => {
    expect(canRunBySingle(BlockEnum.LLM, true)).toBe(true)
  })

  it('should return false for End node', () => {
    expect(canRunBySingle(BlockEnum.End, false)).toBe(false)
  })

  it('should return false for Answer node', () => {
    expect(canRunBySingle(BlockEnum.Answer, false)).toBe(false)
  })
})

describe('isSupportCustomRunForm', () => {
  it('should return true for DataSource', () => {
    expect(isSupportCustomRunForm(BlockEnum.DataSource)).toBe(true)
  })

  it('should return false for other types', () => {
    expect(isSupportCustomRunForm(BlockEnum.LLM)).toBe(false)
    expect(isSupportCustomRunForm(BlockEnum.Code)).toBe(false)
  })
})

describe('hasErrorHandleNode', () => {
  it.each([BlockEnum.LLM, BlockEnum.Tool, BlockEnum.HttpRequest, BlockEnum.Code, BlockEnum.Agent])(
    'should return true for %s',
    (type) => {
      expect(hasErrorHandleNode(type)).toBe(true)
    },
  )

  it('should return false for non-error-handle types', () => {
    expect(hasErrorHandleNode(BlockEnum.Start)).toBe(false)
    expect(hasErrorHandleNode(BlockEnum.Iteration)).toBe(false)
  })

  it('should return false when undefined', () => {
    expect(hasErrorHandleNode()).toBe(false)
  })
})

describe('getNodesConnectedSourceOrTargetHandleIdsMap', () => {
  it('should add handle ids when type is add', () => {
    const node1 = createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } })
    const node2 = createNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } })
    const edge = createEdge({
      source: 'a',
      target: 'b',
      sourceHandle: 'src-handle',
      targetHandle: 'tgt-handle',
    })

    const result = getNodesConnectedSourceOrTargetHandleIdsMap(
      [{ type: 'add', edge }],
      [node1, node2],
    )

    expect(result.a._connectedSourceHandleIds).toContain('src-handle')
    expect(result.b._connectedTargetHandleIds).toContain('tgt-handle')
  })

  it('should remove handle ids when type is remove', () => {
    const node1 = createNode({
      id: 'a',
      data: { type: BlockEnum.Start, title: '', desc: '', _connectedSourceHandleIds: ['src-handle'] },
    })
    const node2 = createNode({
      id: 'b',
      data: { type: BlockEnum.Code, title: '', desc: '', _connectedTargetHandleIds: ['tgt-handle'] },
    })
    const edge = createEdge({
      source: 'a',
      target: 'b',
      sourceHandle: 'src-handle',
      targetHandle: 'tgt-handle',
    })

    const result = getNodesConnectedSourceOrTargetHandleIdsMap(
      [{ type: 'remove', edge }],
      [node1, node2],
    )

    expect(result.a._connectedSourceHandleIds).not.toContain('src-handle')
    expect(result.b._connectedTargetHandleIds).not.toContain('tgt-handle')
  })

  it('should use default handle ids when sourceHandle/targetHandle are missing', () => {
    const node1 = createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } })
    const node2 = createNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } })
    const edge = createEdge({ source: 'a', target: 'b' })
    Reflect.deleteProperty(edge, 'sourceHandle')
    Reflect.deleteProperty(edge, 'targetHandle')

    const result = getNodesConnectedSourceOrTargetHandleIdsMap(
      [{ type: 'add', edge }],
      [node1, node2],
    )

    expect(result.a._connectedSourceHandleIds).toContain('source')
    expect(result.b._connectedTargetHandleIds).toContain('target')
  })

  it('should skip when source node is not found', () => {
    const node2 = createNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } })
    const edge = createEdge({ source: 'missing', target: 'b', sourceHandle: 'src' })

    const result = getNodesConnectedSourceOrTargetHandleIdsMap(
      [{ type: 'add', edge }],
      [node2],
    )

    expect(result.missing).toBeUndefined()
    expect(result.b._connectedTargetHandleIds).toBeDefined()
  })

  it('should skip when target node is not found', () => {
    const node1 = createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } })
    const edge = createEdge({ source: 'a', target: 'missing', targetHandle: 'tgt' })

    const result = getNodesConnectedSourceOrTargetHandleIdsMap(
      [{ type: 'add', edge }],
      [node1],
    )

    expect(result.a._connectedSourceHandleIds).toBeDefined()
    expect(result.missing).toBeUndefined()
  })

  it('should reuse existing map entry for same node across multiple changes', () => {
    const node1 = createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } })
    const node2 = createNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } })
    const node3 = createNode({ id: 'c', data: { type: BlockEnum.Code, title: '', desc: '' } })
    const edge1 = createEdge({ source: 'a', target: 'b', sourceHandle: 'h1' })
    const edge2 = createEdge({ source: 'a', target: 'c', sourceHandle: 'h2' })

    const result = getNodesConnectedSourceOrTargetHandleIdsMap(
      [{ type: 'add', edge: edge1 }, { type: 'add', edge: edge2 }],
      [node1, node2, node3],
    )

    expect(result.a._connectedSourceHandleIds).toContain('h1')
    expect(result.a._connectedSourceHandleIds).toContain('h2')
  })

  it('should fallback to empty arrays when node data has no handle id arrays', () => {
    const node1 = createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } })
    const node2 = createNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } })
    Reflect.deleteProperty(node1.data, '_connectedSourceHandleIds')
    Reflect.deleteProperty(node1.data, '_connectedTargetHandleIds')
    Reflect.deleteProperty(node2.data, '_connectedSourceHandleIds')
    Reflect.deleteProperty(node2.data, '_connectedTargetHandleIds')

    const edge = createEdge({ source: 'a', target: 'b', sourceHandle: 'h1', targetHandle: 'h2' })

    const result = getNodesConnectedSourceOrTargetHandleIdsMap(
      [{ type: 'add', edge }],
      [node1, node2],
    )

    expect(result.a._connectedSourceHandleIds).toContain('h1')
    expect(result.b._connectedTargetHandleIds).toContain('h2')
  })
})

describe('getValidTreeNodes', () => {
  it('should return empty when there are no start/trigger nodes', () => {
    const nodes = [
      createNode({ id: 'n1', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const result = getValidTreeNodes(nodes, [])
    expect(result.validNodes).toEqual([])
    expect(result.maxDepth).toBe(0)
  })

  it('should traverse a linear graph from Start', () => {
    const nodes = [
      createNode({ id: 'start', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'llm', data: { type: BlockEnum.LLM, title: '', desc: '' } }),
      createNode({ id: 'end', data: { type: BlockEnum.End, title: '', desc: '' } }),
    ]
    const edges = [
      createEdge({ source: 'start', target: 'llm' }),
      createEdge({ source: 'llm', target: 'end' }),
    ]

    const result = getValidTreeNodes(nodes, edges)
    expect(result.validNodes.map(n => n.id)).toEqual(['start', 'llm', 'end'])
    expect(result.maxDepth).toBe(3)
  })

  it('should traverse from trigger nodes', () => {
    const nodes = [
      createNode({ id: 'trigger', data: { type: BlockEnum.TriggerWebhook, title: '', desc: '' } }),
      createNode({ id: 'code', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      createEdge({ source: 'trigger', target: 'code' }),
    ]

    const result = getValidTreeNodes(nodes, edges)
    expect(result.validNodes.map(n => n.id)).toContain('trigger')
    expect(result.validNodes.map(n => n.id)).toContain('code')
  })

  it('should include iteration children as valid nodes', () => {
    const nodes = [
      createNode({ id: 'start', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'iter', data: { type: BlockEnum.Iteration, title: '', desc: '' } }),
      createNode({ id: 'child1', data: { type: BlockEnum.Code, title: '', desc: '' }, parentId: 'iter' }),
    ]
    const edges = [
      createEdge({ source: 'start', target: 'iter' }),
    ]

    const result = getValidTreeNodes(nodes, edges)
    expect(result.validNodes.map(n => n.id)).toContain('child1')
  })

  it('should include loop children when loop has outgoers', () => {
    const nodes = [
      createNode({ id: 'start', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'loop', data: { type: BlockEnum.Loop, title: '', desc: '' } }),
      createNode({ id: 'loop-child', data: { type: BlockEnum.Code, title: '', desc: '' }, parentId: 'loop' }),
      createNode({ id: 'end', data: { type: BlockEnum.End, title: '', desc: '' } }),
    ]
    const edges = [
      createEdge({ source: 'start', target: 'loop' }),
      createEdge({ source: 'loop', target: 'end' }),
    ]

    const result = getValidTreeNodes(nodes, edges)
    expect(result.validNodes.map(n => n.id)).toContain('loop-child')
  })

  it('should include loop children as valid nodes when loop is a leaf', () => {
    const nodes = [
      createNode({ id: 'start', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'loop', data: { type: BlockEnum.Loop, title: '', desc: '' } }),
      createNode({ id: 'loop-child', data: { type: BlockEnum.Code, title: '', desc: '' }, parentId: 'loop' }),
    ]
    const edges = [
      createEdge({ source: 'start', target: 'loop' }),
    ]

    const result = getValidTreeNodes(nodes, edges)
    expect(result.validNodes.map(n => n.id)).toContain('loop-child')
  })

  it('should handle cycles without infinite loop', () => {
    const nodes = [
      createNode({ id: 'start', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'a', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      createNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      createEdge({ source: 'start', target: 'a' }),
      createEdge({ source: 'a', target: 'b' }),
      createEdge({ source: 'b', target: 'a' }),
    ]

    const result = getValidTreeNodes(nodes, edges)
    expect(result.validNodes).toHaveLength(3)
  })

  it('should exclude disconnected nodes', () => {
    const nodes = [
      createNode({ id: 'start', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'connected', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      createNode({ id: 'isolated', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      createEdge({ source: 'start', target: 'connected' }),
    ]

    const result = getValidTreeNodes(nodes, edges)
    expect(result.validNodes.map(n => n.id)).not.toContain('isolated')
  })

  it('should handle multiple start nodes without double-traversal', () => {
    const nodes = [
      createNode({ id: 'start1', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'trigger', data: { type: BlockEnum.TriggerSchedule, title: '', desc: '' } }),
      createNode({ id: 'shared', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      createEdge({ source: 'start1', target: 'shared' }),
      createEdge({ source: 'trigger', target: 'shared' }),
    ]

    const result = getValidTreeNodes(nodes, edges)
    expect(result.validNodes.map(n => n.id)).toContain('start1')
    expect(result.validNodes.map(n => n.id)).toContain('trigger')
    expect(result.validNodes.map(n => n.id)).toContain('shared')
  })

  it('should not increase maxDepth when visiting nodes at same or lower depth', () => {
    const nodes = [
      createNode({ id: 'start', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'a', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      createNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      createEdge({ source: 'start', target: 'a' }),
      createEdge({ source: 'start', target: 'b' }),
    ]

    const result = getValidTreeNodes(nodes, edges)
    expect(result.maxDepth).toBe(2)
  })

  it('should traverse from all trigger types', () => {
    const nodes = [
      createNode({ id: 'ts', data: { type: BlockEnum.TriggerSchedule, title: '', desc: '' } }),
      createNode({ id: 'tp', data: { type: BlockEnum.TriggerPlugin, title: '', desc: '' } }),
      createNode({ id: 'code1', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      createNode({ id: 'code2', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      createEdge({ source: 'ts', target: 'code1' }),
      createEdge({ source: 'tp', target: 'code2' }),
    ]

    const result = getValidTreeNodes(nodes, edges)
    expect(result.validNodes).toHaveLength(4)
  })

  it('should skip start nodes already visited by a previous start node traversal', () => {
    const nodes = [
      createNode({ id: 'start1', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'start2', data: { type: BlockEnum.TriggerWebhook, title: '', desc: '' } }),
      createNode({ id: 'shared', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      createEdge({ source: 'start1', target: 'start2' }),
      createEdge({ source: 'start2', target: 'shared' }),
    ]

    const result = getValidTreeNodes(nodes, edges)
    expect(result.validNodes.map(n => n.id)).toContain('start1')
    expect(result.validNodes.map(n => n.id)).toContain('start2')
    expect(result.validNodes.map(n => n.id)).toContain('shared')
  })
})

describe('changeNodesAndEdgesId', () => {
  it('should replace all node and edge ids with new uuids', () => {
    const nodes = [
      createNode({ id: 'old-1', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'old-2', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      createEdge({ source: 'old-1', target: 'old-2' }),
    ]

    const [newNodes, newEdges] = changeNodesAndEdgesId(nodes, edges)

    expect(newNodes[0].id).not.toBe('old-1')
    expect(newNodes[1].id).not.toBe('old-2')
    expect(newEdges[0].source).toBe(newNodes[0].id)
    expect(newEdges[0].target).toBe(newNodes[1].id)
  })

  it('should generate unique ids for all nodes', () => {
    const nodes = [
      createNode({ id: 'a' }),
      createNode({ id: 'b' }),
      createNode({ id: 'c' }),
    ]

    const [newNodes] = changeNodesAndEdgesId(nodes, [])
    const ids = new Set(newNodes.map(n => n.id))
    expect(ids.size).toBe(3)
  })
})
