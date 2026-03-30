import type { Node } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import {
  buildIterationChildCopy,
  getIterationChildren,
  getIterationContainerBounds,
  getIterationContainerResize,
  getNextChildNodeTypeCount,
  getRestrictedIterationPosition,
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

describe('iteration interaction helpers', () => {
  it('calculates bounds, resize and drag restriction for iteration containers', () => {
    const children = [
      createNode({ id: 'a', position: { x: 20, y: 10 }, width: 80, height: 40 }),
      createNode({ id: 'b', position: { x: 120, y: 60 }, width: 50, height: 30 }),
    ]
    const bounds = getIterationContainerBounds(children as Node[])
    expect(bounds.rightNode?.id).toBe('b')
    expect(bounds.bottomNode?.id).toBe('b')
    expect(getIterationContainerResize(createNode({ width: 120, height: 80 }) as Node, bounds)).toEqual({
      width: 186,
      height: 110,
    })
    expect(getRestrictedIterationPosition(
      createNode({
        position: { x: -10, y: 160 },
        width: 80,
        height: 40,
        data: { isInIteration: true },
      }),
      createNode({ width: 200, height: 180 }) as Node,
    )).toEqual({ x: 16, y: 120 })
    expect(getRestrictedIterationPosition(
      createNode({
        position: { x: 180, y: -4 },
        width: 40,
        height: 30,
        data: { isInIteration: true },
      }),
      createNode({ width: 200, height: 180 }) as Node,
    )).toEqual({ x: 144, y: 65 })
  })

  it('filters iteration children and increments per-type counts', () => {
    const typeCount = {} as Parameters<typeof getNextChildNodeTypeCount>[0]
    expect(getNextChildNodeTypeCount(typeCount, BlockEnum.Code, 2)).toBe(3)
    expect(getNextChildNodeTypeCount(typeCount, BlockEnum.Code, 2)).toBe(4)
    expect(getIterationChildren([
      createNode({ id: 'child', parentId: 'iteration-1' }),
      createNode({ id: 'start', parentId: 'iteration-1', type: 'custom-iteration-start' }),
      createNode({ id: 'other', parentId: 'other-iteration' }),
    ] as Node[], 'iteration-1').map(item => item.id)).toEqual(['child'])
  })

  it('keeps bounds, resize and positions empty when no container restriction applies', () => {
    expect(getIterationContainerBounds([])).toEqual({})
    expect(getIterationContainerResize(createNode({ width: 300, height: 240 }) as Node, {})).toEqual({
      width: undefined,
      height: undefined,
    })
    expect(getRestrictedIterationPosition(
      createNode({ data: { isInIteration: true } }),
      undefined,
    )).toEqual({ x: undefined, y: undefined })
    expect(getRestrictedIterationPosition(
      createNode({ data: { isInIteration: false } }),
      createNode({ width: 200, height: 180 }) as Node,
    )).toEqual({ x: undefined, y: undefined })
  })

  it('builds copied iteration children with iteration metadata', () => {
    const child = createNode({
      id: 'child',
      position: { x: 12, y: 24 },
      positionAbsolute: { x: 12, y: 24 },
      extent: 'parent',
      zIndex: 7,
      data: { type: BlockEnum.Code, title: 'Original', desc: 'child', selected: true },
    })

    const result = buildIterationChildCopy({
      child: child as Node,
      childNodeType: BlockEnum.Code,
      defaultValue: { title: 'Code', desc: '', type: BlockEnum.Code } as Node['data'],
      title: 'blocks.code 3',
      newNodeId: 'iteration-2',
    })

    expect(result).toEqual(expect.objectContaining({
      parentId: 'iteration-2',
      zIndex: 7,
      data: expect.objectContaining({
        title: 'blocks.code 3',
        iteration_id: 'iteration-2',
        selected: false,
        _isBundled: false,
      }),
    }))
  })
})
