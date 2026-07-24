import type { IterationNodeType } from '../../nodes/iteration/types'
import type { LoopNodeType } from '../../nodes/loop/types'
import type { CommonNodeType, Node } from '../../types'
import { CUSTOM_NODE, ITERATION_CHILDREN_Z_INDEX, ITERATION_NODE_Z_INDEX, LOOP_CHILDREN_Z_INDEX, LOOP_NODE_Z_INDEX } from '../../constants'
import { CUSTOM_ITERATION_START_NODE } from '../../nodes/iteration-start/constants'
import { CUSTOM_LOOP_START_NODE } from '../../nodes/loop-start/constants'
import { CUSTOM_SIMPLE_NODE } from '../../simple-node/constants'
import { BlockEnum } from '../../types'
import {
  generateNewNode,
  genNewNodeTitleFromOld,
  getIterationStartNode,
  getLoopStartNode,
  getNestedNodePosition,
  getNodeCustomTypeByNodeDataType,
  getTopLeftNodePosition,
  hasRetryNode,
} from '../node'

describe('generateNewNode', () => {
  it('should create a basic node with default CUSTOM_NODE type', () => {
    const { newNode } = generateNewNode({
      data: { title: 'Test', desc: '', type: BlockEnum.Code } as CommonNodeType,
      position: { x: 100, y: 200 },
    })

    expect(newNode.type).toBe(CUSTOM_NODE)
    expect(newNode.position).toEqual({ x: 100, y: 200 })
    expect(newNode.data.title).toBe('Test')
    expect(newNode.id).toBeDefined()
  })

  it('should use provided id when given', () => {
    const { newNode } = generateNewNode({
      id: 'custom-id',
      data: { title: 'Test', desc: '', type: BlockEnum.Code } as CommonNodeType,
      position: { x: 0, y: 0 },
    })

    expect(newNode.id).toBe('custom-id')
  })

  it('should set ITERATION_NODE_Z_INDEX for iteration nodes', () => {
    const { newNode } = generateNewNode({
      data: { title: 'Iter', desc: '', type: BlockEnum.Iteration } as CommonNodeType,
      position: { x: 0, y: 0 },
    })

    expect(newNode.zIndex).toBe(ITERATION_NODE_Z_INDEX)
  })

  it('should set LOOP_NODE_Z_INDEX for loop nodes', () => {
    const { newNode } = generateNewNode({
      data: { title: 'Loop', desc: '', type: BlockEnum.Loop } as CommonNodeType,
      position: { x: 0, y: 0 },
    })

    expect(newNode.zIndex).toBe(LOOP_NODE_Z_INDEX)
  })

  it('should create an iteration start node for iteration type', () => {
    const { newNode, newIterationStartNode } = generateNewNode({
      id: 'iter-1',
      data: { title: 'Iter', desc: '', type: BlockEnum.Iteration } as CommonNodeType,
      position: { x: 0, y: 0 },
    })

    expect(newIterationStartNode).toBeDefined()
    expect(newIterationStartNode!.id).toBe('iter-1start')
    expect(newIterationStartNode!.data.type).toBe(BlockEnum.IterationStart)
    expect((newNode.data as IterationNodeType).start_node_id).toBe('iter-1start')
    expect((newNode.data as CommonNodeType)._children).toEqual([
      { nodeId: 'iter-1start', nodeType: BlockEnum.IterationStart },
    ])
  })

  it('should create a loop start node for loop type', () => {
    const { newNode, newLoopStartNode } = generateNewNode({
      id: 'loop-1',
      data: { title: 'Loop', desc: '', type: BlockEnum.Loop } as CommonNodeType,
      position: { x: 0, y: 0 },
    })

    expect(newLoopStartNode).toBeDefined()
    expect(newLoopStartNode!.id).toBe('loop-1start')
    expect(newLoopStartNode!.data.type).toBe(BlockEnum.LoopStart)
    expect((newNode.data as LoopNodeType).start_node_id).toBe('loop-1start')
    expect((newNode.data as CommonNodeType)._children).toEqual([
      { nodeId: 'loop-1start', nodeType: BlockEnum.LoopStart },
    ])
  })

  it('should not create child start nodes for regular types', () => {
    const result = generateNewNode({
      data: { title: 'Code', desc: '', type: BlockEnum.Code } as CommonNodeType,
      position: { x: 0, y: 0 },
    })

    expect(result.newIterationStartNode).toBeUndefined()
    expect(result.newLoopStartNode).toBeUndefined()
  })
})

describe('getIterationStartNode', () => {
  it('should create a properly configured iteration start node', () => {
    const node = getIterationStartNode('parent-iter')

    expect(node.id).toBe('parent-iterstart')
    expect(node.type).toBe(CUSTOM_ITERATION_START_NODE)
    expect(node.data.type).toBe(BlockEnum.IterationStart)
    expect(node.data.isInIteration).toBe(true)
    expect(node.parentId).toBe('parent-iter')
    expect(node.selectable).toBe(false)
    expect(node.draggable).toBe(false)
    expect(node.zIndex).toBe(ITERATION_CHILDREN_Z_INDEX)
    expect(node.position).toEqual({ x: 24, y: 68 })
  })
})

describe('getLoopStartNode', () => {
  it('should create a properly configured loop start node', () => {
    const node = getLoopStartNode('parent-loop')

    expect(node.id).toBe('parent-loopstart')
    expect(node.type).toBe(CUSTOM_LOOP_START_NODE)
    expect(node.data.type).toBe(BlockEnum.LoopStart)
    expect(node.data.isInLoop).toBe(true)
    expect(node.parentId).toBe('parent-loop')
    expect(node.selectable).toBe(false)
    expect(node.draggable).toBe(false)
    expect(node.zIndex).toBe(LOOP_CHILDREN_Z_INDEX)
    expect(node.position).toEqual({ x: 24, y: 68 })
  })
})

describe('genNewNodeTitleFromOld', () => {
  it('should append (1) to a title without a counter', () => {
    expect(genNewNodeTitleFromOld('LLM')).toBe('LLM (1)')
  })

  it('should increment existing counter', () => {
    expect(genNewNodeTitleFromOld('LLM (1)')).toBe('LLM (2)')
    expect(genNewNodeTitleFromOld('LLM (99)')).toBe('LLM (100)')
  })

  it('should handle titles with spaces around counter', () => {
    expect(genNewNodeTitleFromOld('My Node (3)')).toBe('My Node (4)')
  })

  it('should handle titles that happen to contain parentheses in the name', () => {
    expect(genNewNodeTitleFromOld('Node (special) name')).toBe('Node (special) name (1)')
  })
})

describe('getTopLeftNodePosition', () => {
  it('should return the minimum x and y from nodes', () => {
    const nodes = [
      { position: { x: 100, y: 50 } },
      { position: { x: 20, y: 200 } },
      { position: { x: 50, y: 10 } },
    ] as Node[]

    expect(getTopLeftNodePosition(nodes)).toEqual({ x: 20, y: 10 })
  })

  it('should handle a single node', () => {
    const nodes = [{ position: { x: 42, y: 99 } }] as Node[]
    expect(getTopLeftNodePosition(nodes)).toEqual({ x: 42, y: 99 })
  })

  it('should handle negative positions', () => {
    const nodes = [
      { position: { x: -10, y: -20 } },
      { position: { x: 5, y: -30 } },
    ] as Node[]

    expect(getTopLeftNodePosition(nodes)).toEqual({ x: -10, y: -30 })
  })
})

describe('getNestedNodePosition', () => {
  it('should compute relative position of child to parent', () => {
    const node = { position: { x: 150, y: 200 } } as Node
    const parent = { position: { x: 100, y: 80 } } as Node

    expect(getNestedNodePosition(node, parent)).toEqual({ x: 50, y: 120 })
  })
})

describe('hasRetryNode', () => {
  it.each([BlockEnum.LLM, BlockEnum.Tool, BlockEnum.HttpRequest, BlockEnum.Code])(
    'should return true for %s',
    (nodeType) => {
      expect(hasRetryNode(nodeType)).toBe(true)
    },
  )

  it.each([BlockEnum.Start, BlockEnum.End, BlockEnum.IfElse, BlockEnum.Iteration])(
    'should return false for %s',
    (nodeType) => {
      expect(hasRetryNode(nodeType)).toBe(false)
    },
  )

  it('should return false when nodeType is undefined', () => {
    expect(hasRetryNode()).toBe(false)
  })
})

describe('getNodeCustomTypeByNodeDataType', () => {
  it('should return CUSTOM_SIMPLE_NODE for LoopEnd', () => {
    expect(getNodeCustomTypeByNodeDataType(BlockEnum.LoopEnd)).toBe(CUSTOM_SIMPLE_NODE)
  })

  it('should return undefined for other types', () => {
    expect(getNodeCustomTypeByNodeDataType(BlockEnum.Code)).toBeUndefined()
    expect(getNodeCustomTypeByNodeDataType(BlockEnum.LLM)).toBeUndefined()
  })
})
