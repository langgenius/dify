import type { Node } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import {
  buildLoopChildCopy,
  getContainerBounds,
  getContainerResize,
  getLoopChildren,
  getRestrictedLoopPosition,
} from '../use-interactions.helpers'

const createNode = (overrides: Record<string, unknown> = {}) => ({
  id: 'node',
  type: 'custom',
  position: { x: 0, y: 0 },
  width: 100,
  height: 80,
  data: { type: BlockEnum.Code, title: 'Code', desc: '' },
  ...overrides,
})

describe('loop interaction helpers', () => {
  it('calculates bounds and container resize from overflowing children', () => {
    const children = [
      createNode({ id: 'a', position: { x: 20, y: 10 }, width: 80, height: 40 }),
      createNode({ id: 'b', position: { x: 120, y: 60 }, width: 50, height: 30 }),
    ]

    const bounds = getContainerBounds(children as Node[])
    expect(bounds.rightNode?.id).toBe('b')
    expect(bounds.bottomNode?.id).toBe('b')
    expect(getContainerResize(createNode({ width: 120, height: 80 }) as Node, bounds)).toEqual({
      width: 186,
      height: 110,
    })
    expect(getContainerResize(createNode({ width: 300, height: 300 }), bounds)).toEqual({
      width: undefined,
      height: undefined,
    })
  })

  it('restricts loop positions only for loop children and filters loop-start nodes', () => {
    const parent = createNode({ id: 'parent', width: 200, height: 180 })
    expect(getRestrictedLoopPosition(createNode({ data: { isInLoop: false } }) as Node, parent as Node)).toEqual({ x: undefined, y: undefined })
    expect(getRestrictedLoopPosition(
      createNode({
        position: { x: -10, y: 160 },
        width: 80,
        height: 40,
        data: { isInLoop: true },
      }),
      parent as Node,
    )).toEqual({ x: 16, y: 120 })
    expect(getRestrictedLoopPosition(
      createNode({
        position: { x: 180, y: -4 },
        width: 40,
        height: 30,
        data: { isInLoop: true },
      }),
      parent as Node,
    )).toEqual({ x: 144, y: 65 })
    expect(getLoopChildren([
      createNode({ id: 'child', parentId: 'loop-1' }),
      createNode({ id: 'start', parentId: 'loop-1', type: 'custom-loop-start' }),
      createNode({ id: 'other', parentId: 'other-loop' }),
    ] as Node[], 'loop-1').map(item => item.id)).toEqual(['child'])
  })

  it('builds copied loop children with derived title and loop metadata', () => {
    const child = createNode({
      id: 'child',
      position: { x: 12, y: 24 },
      positionAbsolute: { x: 12, y: 24 },
      extent: 'parent',
      data: { type: BlockEnum.Code, title: 'Original', desc: 'child', selected: true },
    })

    const result = buildLoopChildCopy({
      child: child as Node,
      childNodeType: BlockEnum.Code,
      defaultValue: { title: 'Code', desc: '', type: BlockEnum.Code } as Node['data'],
      nodesWithSameTypeCount: 2,
      newNodeId: 'loop-2',
      index: 3,
    })

    expect(result.newId).toBe('loop-23')
    expect(result.params).toEqual(expect.objectContaining({
      parentId: 'loop-2',
      zIndex: 1002,
      data: expect.objectContaining({
        title: 'Code 3',
        isInLoop: true,
        loop_id: 'loop-2',
        selected: false,
        _isBundled: false,
      }),
    }))
  })
})
