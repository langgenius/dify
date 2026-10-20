import type { IfElseNodeType } from '../../nodes/if-else/types'
import type { IterationNodeType } from '../../nodes/iteration/types'
import type { KnowledgeRetrievalNodeType } from '../../nodes/knowledge-retrieval/types'
import type { LLMNodeType } from '../../nodes/llm/types'
import type { LoopNodeType } from '../../nodes/loop/types'
import type { ParameterExtractorNodeType } from '../../nodes/parameter-extractor/types'
import type { ToolNodeType } from '../../nodes/tool/types'
import {
  CUSTOM_NODE,
  DEFAULT_RETRY_INTERVAL,
  DEFAULT_RETRY_MAX,
  NESTED_ELEMENT_Z_INDEX,
} from '@/app/components/workflow/constants'
import { CUSTOM_ITERATION_START_NODE } from '@/app/components/workflow/nodes/iteration-start/constants'
import { CUSTOM_LOOP_START_NODE } from '@/app/components/workflow/nodes/loop-start/constants'
import { BlockEnum, ErrorHandleMode } from '@/app/components/workflow/types'
import { createEdge, createNode, resetFixtureCounters } from '../../__tests__/fixtures'
import { initialEdges, initialNodes, preprocessNodesAndEdges } from '../workflow-init'

beforeEach(() => {
  resetFixtureCounters()
  vi.clearAllMocks()
})

describe.each([
  [BlockEnum.Iteration, BlockEnum.IterationStart, CUSTOM_ITERATION_START_NODE],
  [BlockEnum.Loop, BlockEnum.LoopStart, CUSTOM_LOOP_START_NODE],
])('migrates legacy %s containers', (containerType, startType, customType) => {
  it.each([undefined, 'missing-child'])(
    'creates a valid start when the old reference is %s',
    (startId) => {
      const container = createNode({
        id: 'container',
        data: { type: containerType, title: '', desc: '', start_node_id: startId },
      })
      const result = preprocessNodesAndEdges([container], [])
      const start = result.nodes.find((node) => node.data.type === startType)!
      expect(start).toMatchObject({ parentId: 'container', type: customType })
      expect(result.nodes.find((node) => node.id === 'container')!.data).toMatchObject({
        start_node_id: start.id,
      })
      expect(result.edges).toEqual([])
      expect(preprocessNodesAndEdges(result.nodes, result.edges)).toEqual(result)
    },
  )

  it('connects the new start to the previous entry and preserves existing child edges', () => {
    const nodes = [
      createNode({
        id: 'container',
        data: { type: containerType, title: '', desc: '', start_node_id: 'child' },
      }),
      createNode({
        id: 'child',
        parentId: 'container',
        data: { type: BlockEnum.Code, title: '', desc: '' },
      }),
      createNode({
        id: 'next',
        parentId: 'container',
        data: { type: BlockEnum.Code, title: '', desc: '' },
      }),
    ]
    const existing = createEdge({ source: 'child', target: 'next' })
    const result = preprocessNodesAndEdges(nodes, [existing])
    const start = result.nodes.find((node) => node.data.type === startType)!
    expect(result.nodes.find((node) => node.id === 'container')!.data).toMatchObject({
      start_node_id: start.id,
    })
    expect(result.edges).toEqual([
      existing,
      expect.objectContaining({
        source: start.id,
        target: 'child',
        sourceHandle: 'source',
        targetHandle: 'target',
        data: expect.objectContaining({
          sourceType: startType,
          targetType: BlockEnum.Code,
          isInIteration: containerType === BlockEnum.Iteration,
          isInLoop: containerType === BlockEnum.Loop,
        }),
      }),
    ])
    expect(preprocessNodesAndEdges(result.nodes, result.edges)).toEqual(result)
  })
})

describe('initialNodes', () => {
  it('should normalize legacy container and nested node layers regardless of node order', () => {
    const nodes = [
      createNode({
        id: 'child-1',
        parentId: 'iter-1',
        zIndex: 1002,
        data: { type: BlockEnum.Code, title: '', desc: '' },
      }),
      createNode({
        id: 'iter-1',
        selected: true,
        zIndex: 1,
        data: { type: BlockEnum.Iteration, title: '', desc: '' },
      }),
      createNode({
        id: 'root-1',
        zIndex: 1002,
        data: { type: BlockEnum.Code, title: '', desc: '' },
      }),
    ]

    const result = initialNodes(nodes, [])

    const parentNode = result.find((node) => node.id === 'iter-1')!
    const childNode = result.find((node) => node.id === 'child-1')!
    expect(parentNode.zIndex).toBe(0)
    expect(childNode.zIndex).toBe(NESTED_ELEMENT_Z_INDEX)
    expect(result.find((node) => node.id === 'root-1')!.zIndex).toBe(0)
    expect(parentNode.zIndex! + 1000).toBeLessThan(childNode.zIndex!)
  })

  it('should set positions when first node has no position', () => {
    const nodes = [
      createNode({ id: 'n1', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'n2', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    nodes.forEach((n) => Reflect.deleteProperty(n, 'position'))

    const result = initialNodes(nodes, [])
    expect(result[0]!.position).toBeDefined()
    expect(result[1]!.position).toBeDefined()
    expect(result[1]!.position.x).toBeGreaterThan(result[0]!.position.x)
  })

  it('should set type to CUSTOM_NODE when type is missing', () => {
    const nodes = [createNode({ id: 'n1', data: { type: BlockEnum.Start, title: '', desc: '' } })]
    Reflect.deleteProperty(nodes[0]!, 'type')

    const result = initialNodes(nodes, [])
    expect(result[0]!.type).toBe(CUSTOM_NODE)
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
    expect(result[0]!.data._connectedSourceHandleIds).toContain('source')
    expect(result[1]!.data._connectedTargetHandleIds).toContain('target')
  })

  it('should handle IfElse node with cases', () => {
    const nodes = [
      createNode({
        id: 'if-1',
        data: {
          type: BlockEnum.IfElse,
          title: '',
          desc: '',
          cases: [{ case_id: 'case-1', logical_operator: 'and', conditions: [] }],
        },
      }),
    ]

    const result = initialNodes(nodes, [])
    expect(result[0]!.data._targetBranches?.map((branch) => branch.id)).toEqual(['case-1', 'false'])
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
    const data = result[0]!.data as IfElseNodeType
    expect(data.cases).toEqual([
      { case_id: 'true', logical_operator: 'and', conditions: [{ id: 'c1', value: 'test' }] },
    ])
    expect(data.conditions).toBeUndefined()
    expect(data.logical_operator).toBeUndefined()
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
    const data = result[0]!.data as IfElseNodeType
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
    expect(result[0]!.data._targetBranches).toEqual([{ id: 'cls-1', name: 'Class 1' }])
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
    const iterNode = result.find((n) => n.id === 'iter-1')!
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
    const loopNode = result.find((n) => n.id === 'loop-1')!
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
    const iterNode = result.find((n) => n.id === 'iter-1')!
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
    expect((result[0]!.data as LLMNodeType).model.provider).toBe('langgenius/openai/openai')
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
    expect(
      (result[0]!.data as KnowledgeRetrievalNodeType).multiple_retrieval_config!.reranking_model!
        .provider,
    ).toBe('langgenius/cohere/cohere')
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
    expect((result[0]!.data as ParameterExtractorNodeType).model.provider).toBe(
      'langgenius/anthropic/anthropic',
    )
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
    expect(result[0]!.data.retry_config).toEqual({
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
    expect(result[0]!.data.retry_config).toEqual(existingConfig)
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
            optional_key: null,
            nested: { type: 'constant', value: 'already-migrated' },
          },
        },
      }),
    ]

    const result = initialNodes(nodes, [])
    const data = result[0]!.data as ToolNodeType
    expect(data.tool_node_version).toBe('2')
    expect(data.tool_configurations.optional_key).toEqual({ type: 'constant', value: null })
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
    const data = result[0]!.data as ToolNodeType
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
    const data = result[0]!.data as ToolNodeType
    expect(data.tool_configurations).toEqual({ key: 'val' })
  })

  it('should normalize legacy nested and root edge layers', () => {
    const nodes = [
      createNode({ id: 'iter-1', data: { type: BlockEnum.Iteration, title: '', desc: '' } }),
      createNode({
        id: 'child-1',
        parentId: 'iter-1',
        data: { type: BlockEnum.Code, title: '', desc: '' },
      }),
      createNode({
        id: 'child-2',
        parentId: 'iter-1',
        data: { type: BlockEnum.Code, title: '', desc: '' },
      }),
      createNode({ id: 'root-1', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      createEdge({ id: 'nested-edge', source: 'child-1', target: 'child-2', zIndex: 1002 }),
      createEdge({ id: 'boundary-edge', source: 'child-2', target: 'root-1', zIndex: 1002 }),
      createEdge({ id: 'root-edge', source: 'root-1', target: 'iter-1', zIndex: 1002 }),
    ]

    const result = initialEdges(edges, nodes)

    expect(result.find((edge) => edge.id === 'nested-edge')!.zIndex).toBe(NESTED_ELEMENT_Z_INDEX)
    expect(result.find((edge) => edge.id === 'boundary-edge')!.zIndex).toBe(NESTED_ELEMENT_Z_INDEX)
    expect(result.find((edge) => edge.id === 'root-edge')!.zIndex).toBe(0)
    expect(result.find((edge) => edge.id === 'nested-edge')!.data).toEqual(
      expect.objectContaining({
        isInIteration: true,
        iteration_id: 'iter-1',
        isInLoop: false,
        loop_id: undefined,
      }),
    )
    expect(result.find((edge) => edge.id === 'boundary-edge')!.data).toEqual(
      expect.objectContaining({
        isInIteration: true,
        iteration_id: 'iter-1',
        isInLoop: false,
        loop_id: undefined,
      }),
    )
    expect(result.find((edge) => edge.id === 'root-edge')!.data).toEqual(
      expect.objectContaining({
        isInIteration: false,
        iteration_id: undefined,
        isInLoop: false,
        loop_id: undefined,
      }),
    )
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
    expect(result[0]!).toMatchObject({
      type: 'custom',
      data: { sourceType: BlockEnum.Start, targetType: BlockEnum.Code },
    })
    expect(result[0]!.sourceHandle).toBe('source')
    expect(result[0]!.targetHandle).toBe('target')
  })

  it('should set _connectedNodeIsSelected when a node is selected', () => {
    const nodes = [
      createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '', selected: true } }),
      createNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [createEdge({ source: 'a', target: 'b' })]

    const result = initialEdges(edges, nodes)
    expect(result[0]!.data!._connectedNodeIsSelected).toBe(true)
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
    expect(result.map((edge) => [edge.source, edge.target])).toEqual([['a', 'b']])
  })

  it('should handle edges where source/target node is missing from nodesMap', () => {
    const nodes = [createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } })]
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
    expect(result[0]!.data!._connectedNodeIsSelected).toBe(true)
  })

  it('should not set default sourceHandle when sourceHandle already exists', () => {
    const nodes = [
      createNode({ id: 'a', data: { type: BlockEnum.Start, title: '', desc: '' } }),
      createNode({ id: 'b', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    const edges = [
      createEdge({
        source: 'a',
        target: 'b',
        sourceHandle: 'custom-src',
        targetHandle: 'custom-tgt',
      }),
    ]

    const result = initialEdges(edges, nodes)
    expect(result[0]!.sourceHandle).toBe('custom-src')
    expect(result[0]!.targetHandle).toBe('custom-tgt')
  })

  it('removes cycle edges while preserving connections into, out of, and between cycles', () => {
    const nodes = ['start', 'a', 'b', 'c', 'd', 'self', 'end'].map((id) => createNode({ id }))
    const pairs = [
      ['start', 'a'],
      ['a', 'b'],
      ['b', 'a'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'c'],
      ['d', 'end'],
      ['start', 'self'],
      ['self', 'self'],
      ['self', 'end'],
    ]
    const edges = pairs.map(([source, target]) => createEdge({ source: source!, target: target! }))
    expect(initialEdges(edges, nodes).map((edge) => [edge.source, edge.target])).toEqual([
      ['start', 'a'],
      ['b', 'c'],
      ['d', 'end'],
      ['start', 'self'],
      ['self', 'end'],
    ])
  })
})
