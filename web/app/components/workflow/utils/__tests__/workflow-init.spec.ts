import type { IfElseNodeType } from '../../nodes/if-else/types'
import type { IterationNodeType } from '../../nodes/iteration/types'
import type { KnowledgeRetrievalNodeType } from '../../nodes/knowledge-retrieval/types'
import type { LLMNodeType } from '../../nodes/llm/types'
import type { LoopNodeType } from '../../nodes/loop/types'
import type { ParameterExtractorNodeType } from '../../nodes/parameter-extractor/types'
import type { ToolNodeType } from '../../nodes/tool/types'
import type {
  Edge,
  Node,
} from '@/app/components/workflow/types'
import { CUSTOM_NODE, DEFAULT_RETRY_INTERVAL, DEFAULT_RETRY_MAX } from '@/app/components/workflow/constants'
import { CUSTOM_ITERATION_START_NODE } from '@/app/components/workflow/nodes/iteration-start/constants'
import { CUSTOM_LOOP_START_NODE } from '@/app/components/workflow/nodes/loop-start/constants'
import { BlockEnum, ErrorHandleMode } from '@/app/components/workflow/types'
import { createEdge, createNode, resetFixtureCounters } from '../../__tests__/fixtures'
import { initialEdges, initialNodes, preprocessNodesAndEdges } from '../workflow-init'

vi.mock('reactflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('reactflow')>()
  return {
    ...actual,
    getConnectedEdges: vi.fn((_nodes: Node[], edges: Edge[]) => {
      const node = _nodes[0]
      return edges.filter(e => e.source === node.id || e.target === node.id)
    }),
  }
})

vi.mock('@/utils', () => ({
  correctModelProvider: vi.fn((p: string) => p ? `corrected/${p}` : ''),
}))

vi.mock('@/app/components/workflow/nodes/if-else/utils', () => ({
  branchNameCorrect: vi.fn((branches: Array<Record<string, unknown>>) => branches.map((b: Record<string, unknown>, i: number) => ({
    ...b,
    name: b.id === 'false' ? 'ELSE' : branches.length === 2 ? 'IF' : `CASE ${i + 1}`,
  }))),
}))

beforeEach(() => {
  resetFixtureCounters()
  vi.clearAllMocks()
})

describe('preprocessNodesAndEdges', () => {
  it('should return origin nodes and edges when no iteration/loop nodes exist', () => {
    const nodes = [createNode({ data: { type: BlockEnum.Code, title: '', desc: '' } })]
    const result = preprocessNodesAndEdges(nodes, [])
    expect(result).toEqual({ nodes, edges: [] })
  })

  it('should add iteration start node when iteration has no start_node_id', () => {
    const nodes = [
      createNode({ id: 'iter-1', data: { type: BlockEnum.Iteration, title: '', desc: '' } }),
    ]
    const result = preprocessNodesAndEdges(nodes as Node[], [])
    const startNodes = result.nodes.filter(n => n.data.type === BlockEnum.IterationStart)
    expect(startNodes).toHaveLength(1)
    expect(startNodes[0].parentId).toBe('iter-1')
  })

  it('should add iteration start node when iteration has start_node_id but node type does not match', () => {
    const nodes = [
      createNode({
        id: 'iter-1',
        data: { type: BlockEnum.Iteration, title: '', desc: '', start_node_id: 'some-node' },
      }),
      createNode({ id: 'some-node', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const result = preprocessNodesAndEdges(nodes as Node[], [])
    const startNodes = result.nodes.filter(n => n.data.type === BlockEnum.IterationStart)
    expect(startNodes).toHaveLength(1)
  })

  it('should not add iteration start node when one already exists with correct type', () => {
    const nodes = [
      createNode({
        id: 'iter-1',
        data: { type: BlockEnum.Iteration, title: '', desc: '', start_node_id: 'iter-start' },
      }),
      createNode({
        id: 'iter-start',
        type: CUSTOM_ITERATION_START_NODE,
        data: { type: BlockEnum.IterationStart, title: '', desc: '' },
      }),
    ]
    const result = preprocessNodesAndEdges(nodes as Node[], [])
    expect(result.nodes).toEqual(nodes)
  })

  it('should add loop start node when loop has no start_node_id', () => {
    const nodes = [
      createNode({ id: 'loop-1', data: { type: BlockEnum.Loop, title: '', desc: '' } }),
    ]
    const result = preprocessNodesAndEdges(nodes as Node[], [])
    const startNodes = result.nodes.filter(n => n.data.type === BlockEnum.LoopStart)
    expect(startNodes).toHaveLength(1)
  })

  it('should add loop start node when loop has start_node_id but type does not match', () => {
    const nodes = [
      createNode({
        id: 'loop-1',
        data: { type: BlockEnum.Loop, title: '', desc: '', start_node_id: 'some-node' },
      }),
      createNode({ id: 'some-node', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const result = preprocessNodesAndEdges(nodes as Node[], [])
    const startNodes = result.nodes.filter(n => n.data.type === BlockEnum.LoopStart)
    expect(startNodes).toHaveLength(1)
  })

  it('should not add loop start node when one already exists with correct type', () => {
    const nodes = [
      createNode({
        id: 'loop-1',
        data: { type: BlockEnum.Loop, title: '', desc: '', start_node_id: 'loop-start' },
      }),
      createNode({
        id: 'loop-start',
        type: CUSTOM_LOOP_START_NODE,
        data: { type: BlockEnum.LoopStart, title: '', desc: '' },
      }),
    ]
    const result = preprocessNodesAndEdges(nodes as Node[], [])
    expect(result.nodes).toEqual(nodes)
  })

  it('should create edges linking new start nodes to existing start nodes', () => {
    const nodes = [
      createNode({
        id: 'iter-1',
        data: { type: BlockEnum.Iteration, title: '', desc: '', start_node_id: 'child-1' },
      }),
      createNode({
        id: 'child-1',
        parentId: 'iter-1',
        data: { type: BlockEnum.Code, title: '', desc: '' },
      }),
    ]
    const result = preprocessNodesAndEdges(nodes as Node[], [])
    const newEdges = result.edges
    expect(newEdges).toHaveLength(1)
    expect(newEdges[0].target).toBe('child-1')
    expect(newEdges[0].data!.sourceType).toBe(BlockEnum.IterationStart)
    expect(newEdges[0].data!.isInIteration).toBe(true)
  })

  it('should create edges for loop nodes with start_node_id', () => {
    const nodes = [
      createNode({
        id: 'loop-1',
        data: { type: BlockEnum.Loop, title: '', desc: '', start_node_id: 'child-1' },
      }),
      createNode({
        id: 'child-1',
        parentId: 'loop-1',
        data: { type: BlockEnum.Code, title: '', desc: '' },
      }),
    ]
    const result = preprocessNodesAndEdges(nodes as Node[], [])
    const newEdges = result.edges
    expect(newEdges).toHaveLength(1)
    expect(newEdges[0].target).toBe('child-1')
    expect(newEdges[0].data!.isInLoop).toBe(true)
  })

  it('should update start_node_id on iteration and loop nodes', () => {
    const nodes = [
      createNode({
        id: 'iter-1',
        data: { type: BlockEnum.Iteration, title: '', desc: '' },
      }),
      createNode({
        id: 'loop-1',
        data: { type: BlockEnum.Loop, title: '', desc: '' },
      }),
    ]
    const result = preprocessNodesAndEdges(nodes as Node[], [])
    const iterNode = result.nodes.find(n => n.id === 'iter-1')
    const loopNode = result.nodes.find(n => n.id === 'loop-1')
    expect((iterNode!.data as IterationNodeType).start_node_id).toBeTruthy()
    expect((loopNode!.data as LoopNodeType).start_node_id).toBeTruthy()
  })
})

describe('initialNodes', () => {
  it('should set positions when first node has no position', () => {
    const nodes = [
      createNode({ id: 'n1', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'n2', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    nodes.forEach(n => Reflect.deleteProperty(n, 'position'))

    const result = initialNodes(nodes, [])
    expect(result[0].position).toBeDefined()
    expect(result[1].position).toBeDefined()
    expect(result[1].position.x).toBeGreaterThan(result[0].position.x)
  })

  it('should set type to CUSTOM_NODE when type is missing', () => {
    const nodes = [
      createNode({ id: 'n1', data: { type: BlockEnum.Start, title: '', desc: '' } }),
    ]
    Reflect.deleteProperty(nodes[0], 'type')

    const result = initialNodes(nodes, [])
    expect(result[0].type).toBe(CUSTOM_NODE)
  })

  it('should set connected source and target handle ids', () => {
    const nodes = [
      createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      createEdge({ source: 'a', target: 'b', sourceHandle: 'source', targetHandle: 'target' }),
    ]

    const result = initialNodes(nodes, edges)
    expect(result[0].data._connectedSourceHandleIds).toContain('source')
    expect(result[1].data._connectedTargetHandleIds).toContain('target')
  })

  it('should handle IfElse node with cases', () => {
    const nodes = [
      createNode({
        id: 'if-1',
        data: {
          type: BlockEnum.IfElse,
          title: '',
          desc: '',
          cases: [
            { case_id: 'case-1', logical_operator: 'and', conditions: [] },
          ],
        },
      }),
    ]

    const result = initialNodes(nodes, [])
    expect(result[0].data._targetBranches).toBeDefined()
    expect(result[0].data._targetBranches).toHaveLength(2)
  })

  it('should migrate legacy IfElse node without cases to cases format', () => {
    const nodes = [
      createNode({
        id: 'if-1',
        data: {
          type: BlockEnum.IfElse,
          title: '',
          desc: '',
          logical_operator: 'and',
          conditions: [{ id: 'c1', value: 'test' }],
          cases: undefined,
        },
      }),
    ]

    const result = initialNodes(nodes, [])
    const data = result[0].data as IfElseNodeType
    expect(data.cases).toHaveLength(1)
    expect(data.cases[0].case_id).toBe('true')
  })

  it('should delete legacy conditions/logical_operator when cases exist', () => {
    const nodes = [
      createNode({
        id: 'if-1',
        data: {
          type: BlockEnum.IfElse,
          title: '',
          desc: '',
          logical_operator: 'and',
          conditions: [{ id: 'c1', value: 'test' }],
          cases: [
            { case_id: 'true', logical_operator: 'and', conditions: [{ id: 'c1', value: 'test' }] },
          ],
        },
      }),
    ]

    const result = initialNodes(nodes, [])
    const data = result[0].data as IfElseNodeType
    expect(data.conditions).toBeUndefined()
    expect(data.logical_operator).toBeUndefined()
  })

  it('should set _targetBranches for QuestionClassifier nodes', () => {
    const nodes = [
      createNode({
        id: 'qc-1',
        data: {
          type: BlockEnum.QuestionClassifier,
          title: '',
          desc: '',
          classes: [{ id: 'cls-1', name: 'Class 1' }],
          model: { provider: 'openai' },
        },
      }),
    ]

    const result = initialNodes(nodes, [])
    expect(result[0].data._targetBranches).toHaveLength(1)
  })

  it('should set iteration node defaults', () => {
    const nodes = [
      createNode({
        id: 'iter-1',
        data: {
          type: BlockEnum.Iteration,
          title: '',
          desc: '',
        },
      }),
    ]

    const result = initialNodes(nodes, [])
    const iterNode = result.find(n => n.id === 'iter-1')!
    const data = iterNode.data as IterationNodeType
    expect(data.is_parallel).toBe(false)
    expect(data.parallel_nums).toBe(10)
    expect(data.error_handle_mode).toBe(ErrorHandleMode.Terminated)
    expect(data._children).toBeDefined()
  })

  it('should set loop node defaults', () => {
    const nodes = [
      createNode({
        id: 'loop-1',
        data: {
          type: BlockEnum.Loop,
          title: '',
          desc: '',
        },
      }),
    ]

    const result = initialNodes(nodes, [])
    const loopNode = result.find(n => n.id === 'loop-1')!
    const data = loopNode.data as LoopNodeType
    expect(data.error_handle_mode).toBe(ErrorHandleMode.Terminated)
    expect(data._children).toBeDefined()
  })

  it('should populate _children for iteration nodes with child nodes', () => {
    const nodes = [
      createNode({
        id: 'iter-1',
        data: { type: BlockEnum.Iteration, title: '', desc: '' },
      }),
      createNode({
        id: 'child-1',
        parentId: 'iter-1',
        data: { type: BlockEnum.Code, title: '', desc: '' },
      }),
    ]

    const result = initialNodes(nodes, [])
    const iterNode = result.find(n => n.id === 'iter-1')!
    const data = iterNode.data as IterationNodeType
    expect(data._children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: 'child-1', nodeType: BlockEnum.Code }),
      ]),
    )
  })

  it('should correct model provider for LLM nodes', () => {
    const nodes = [
      createNode({
        id: 'llm-1',
        data: {
          type: BlockEnum.LLM,
          title: '',
          desc: '',
          model: { provider: 'openai' },
        },
      }),
    ]

    const result = initialNodes(nodes, [])
    expect((result[0].data as LLMNodeType).model.provider).toBe('corrected/openai')
  })

  it('should correct model provider for KnowledgeRetrieval reranking_model', () => {
    const nodes = [
      createNode({
        id: 'kr-1',
        data: {
          type: BlockEnum.KnowledgeRetrieval,
          title: '',
          desc: '',
          multiple_retrieval_config: {
            reranking_model: { provider: 'cohere' },
          },
        },
      }),
    ]

    const result = initialNodes(nodes, [])
    expect((result[0].data as KnowledgeRetrievalNodeType).multiple_retrieval_config!.reranking_model!.provider).toBe('corrected/cohere')
  })

  it('should correct model provider for ParameterExtractor nodes', () => {
    const nodes = [
      createNode({
        id: 'pe-1',
        data: {
          type: BlockEnum.ParameterExtractor,
          title: '',
          desc: '',
          model: { provider: 'anthropic' },
        },
      }),
    ]

    const result = initialNodes(nodes, [])
    expect((result[0].data as ParameterExtractorNodeType).model.provider).toBe('corrected/anthropic')
  })

  it('should add default retry_config for HttpRequest nodes', () => {
    const nodes = [
      createNode({
        id: 'http-1',
        data: {
          type: BlockEnum.HttpRequest,
          title: '',
          desc: '',
        },
      }),
    ]

    const result = initialNodes(nodes, [])
    expect(result[0].data.retry_config).toEqual({
      retry_enabled: true,
      max_retries: DEFAULT_RETRY_MAX,
      retry_interval: DEFAULT_RETRY_INTERVAL,
    })
  })

  it('should not overwrite existing retry_config for HttpRequest nodes', () => {
    const existingConfig = { retry_enabled: false, max_retries: 1, retry_interval: 50 }
    const nodes = [
      createNode({
        id: 'http-1',
        data: {
          type: BlockEnum.HttpRequest,
          title: '',
          desc: '',
          retry_config: existingConfig,
        },
      }),
    ]

    const result = initialNodes(nodes, [])
    expect(result[0].data.retry_config).toEqual(existingConfig)
  })

  it('should migrate legacy Tool node configurations', () => {
    const nodes = [
      createNode({
        id: 'tool-1',
        data: {
          type: BlockEnum.Tool,
          title: '',
          desc: '',
          tool_configurations: {
            api_key: 'secret-key',
            nested: { type: 'constant', value: 'already-migrated' },
          },
        },
      }),
    ]

    const result = initialNodes(nodes, [])
    const data = result[0].data as ToolNodeType
    expect(data.tool_node_version).toBe('2')
    expect(data.tool_configurations.api_key).toEqual({
      type: 'constant',
      value: 'secret-key',
    })
    expect(data.tool_configurations.nested).toEqual({
      type: 'constant',
      value: 'already-migrated',
    })
  })

  it('should not migrate Tool node when version already exists', () => {
    const nodes = [
      createNode({
        id: 'tool-1',
        data: {
          type: BlockEnum.Tool,
          title: '',
          desc: '',
          version: '1',
          tool_configurations: { key: 'val' },
        },
      }),
    ]

    const result = initialNodes(nodes, [])
    const data = result[0].data as ToolNodeType
    expect(data.tool_configurations).toEqual({ key: 'val' })
  })

  it('should not migrate Tool node when tool_node_version already exists', () => {
    const nodes = [
      createNode({
        id: 'tool-1',
        data: {
          type: BlockEnum.Tool,
          title: '',
          desc: '',
          tool_node_version: '2',
          tool_configurations: { key: 'val' },
        },
      }),
    ]

    const result = initialNodes(nodes, [])
    const data = result[0].data as ToolNodeType
    expect(data.tool_configurations).toEqual({ key: 'val' })
  })

  it('should handle Tool node with null configuration value', () => {
    const nodes = [
      createNode({
        id: 'tool-1',
        data: {
          type: BlockEnum.Tool,
          title: '',
          desc: '',
          tool_configurations: { key: null },
        },
      }),
    ]

    const result = initialNodes(nodes, [])
    const data = result[0].data as ToolNodeType
    expect(data.tool_configurations.key).toEqual({ type: 'constant', value: null })
  })

  it('should handle Tool node with empty tool_configurations', () => {
    const nodes = [
      createNode({
        id: 'tool-1',
        data: {
          type: BlockEnum.Tool,
          title: '',
          desc: '',
          tool_configurations: {},
        },
      }),
    ]

    const result = initialNodes(nodes, [])
    const data = result[0].data as ToolNodeType
    expect(data.tool_node_version).toBe('2')
  })
})

describe('initialEdges', () => {
  it('should set edge type to custom', () => {
    const nodes = [
      createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [createEdge({ source: 'a', target: 'b' })]

    const result = initialEdges(edges, nodes)
    expect(result[0].type).toBe('custom')
  })

  it('should set default sourceHandle and targetHandle', () => {
    const nodes = [
      createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edge = createEdge({ source: 'a', target: 'b' })
    Reflect.deleteProperty(edge, 'sourceHandle')
    Reflect.deleteProperty(edge, 'targetHandle')

    const result = initialEdges([edge], nodes)
    expect(result[0].sourceHandle).toBe('source')
    expect(result[0].targetHandle).toBe('target')
  })

  it('should set sourceType and targetType from nodes', () => {
    const nodes = [
      createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [createEdge({ source: 'a', target: 'b' })]
    Reflect.deleteProperty(edges[0].data!, 'sourceType')
    Reflect.deleteProperty(edges[0].data!, 'targetType')

    const result = initialEdges(edges, nodes)
    expect(result[0].data!.sourceType).toBe(BlockEnum.Start)
    expect(result[0].data!.targetType).toBe(BlockEnum.Code)
  })

  it('should set _connectedNodeIsSelected when a node is selected', () => {
    const nodes = [
      createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '', selected: true } }),
      createNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [createEdge({ source: 'a', target: 'b' })]

    const result = initialEdges(edges, nodes)
    expect(result[0].data!._connectedNodeIsSelected).toBe(true)
  })

  it('should filter cycle edges', () => {
    const nodes = [
      createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      createNode({ id: 'c', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      createEdge({ source: 'a', target: 'b' }),
      createEdge({ source: 'b', target: 'c' }),
      createEdge({ source: 'c', target: 'b' }),
    ]

    const result = initialEdges(edges, nodes)
    const hasCycleEdge = result.some(
      e => (e.source === 'b' && e.target === 'c') || (e.source === 'c' && e.target === 'b'),
    )
    const hasABEdge = result.some(
      e => e.source === 'a' && e.target === 'b',
    )
    expect(hasCycleEdge).toBe(false)
    // In this specific graph, getCycleEdges treats all nodes remaining in the DFS stack (a, b, c)
    // as part of the cycle, so a→b is also filtered. This assertion documents that behaviour.
    expect(hasABEdge).toBe(false)
  })

  it('should keep non-cycle edges intact', () => {
    const nodes = [
      createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [createEdge({ source: 'a', target: 'b' })]

    const result = initialEdges(edges, nodes)
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('a')
    expect(result[0].target).toBe('b')
  })

  it('should handle empty edges', () => {
    const nodes = [
      createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } }),
    ]
    const result = initialEdges([], nodes)
    expect(result).toHaveLength(0)
  })

  it('should handle edges where source/target node is missing from nodesMap', () => {
    const nodes = [
      createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } }),
    ]
    const edges = [createEdge({ source: 'a', target: 'missing' })]

    const result = initialEdges(edges, nodes)
    expect(result).toHaveLength(1)
  })

  it('should set _connectedNodeIsSelected for edge target matching selected node', () => {
    const nodes = [
      createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '', selected: true } }),
    ]
    const edges = [createEdge({ source: 'a', target: 'b' })]

    const result = initialEdges(edges, nodes)
    expect(result[0].data!._connectedNodeIsSelected).toBe(true)
  })

  it('should not set default sourceHandle when sourceHandle already exists', () => {
    const nodes = [
      createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [createEdge({ source: 'a', target: 'b', sourceHandle: 'custom-src', targetHandle: 'custom-tgt' })]

    const result = initialEdges(edges, nodes)
    expect(result[0].sourceHandle).toBe('custom-src')
    expect(result[0].targetHandle).toBe('custom-tgt')
  })

  it('should handle graph with edges referencing nodes not in the node list', () => {
    const nodes = [
      createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      createEdge({ source: 'a', target: 'b' }),
      createEdge({ source: 'unknown-src', target: 'unknown-tgt' }),
    ]

    const result = initialEdges(edges, nodes)
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  it('should handle self-referencing cycle', () => {
    const nodes = [
      createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      createEdge({ source: 'a', target: 'b' }),
      createEdge({ source: 'b', target: 'b' }),
    ]

    const result = initialEdges(edges, nodes)
    const selfLoop = result.find(e => e.source === 'b' && e.target === 'b')
    expect(selfLoop).toBeUndefined()
  })

  it('should handle complex cycle with multiple nodes', () => {
    const nodes = [
      createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      createNode({ id: 'c', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      createNode({ id: 'd', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      createEdge({ source: 'a', target: 'b' }),
      createEdge({ source: 'b', target: 'c' }),
      createEdge({ source: 'c', target: 'd' }),
      createEdge({ source: 'd', target: 'b' }),
    ]

    const result = initialEdges(edges, nodes)
    expect(result.length).toBeLessThan(edges.length)
  })
})
