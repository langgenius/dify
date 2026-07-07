import { BlockEnum } from '../../types'
import {
  applyContainerSizeChanges,
  applyLayoutToNodes,
  createLayerMap,
  getContainerSizeChanges,
  getLayoutContainerNodes,
} from '../use-workflow-organize.helpers'

type TestNode = {
  id: string
  type: string
  parentId?: string
  position: { x: number, y: number }
  width: number
  height: number
  data: {
    type: BlockEnum
    title: string
    desc: string
    width?: number
    height?: number
  }
}

const createNode = (overrides: Record<string, unknown> = {}) => ({
  id: 'node',
  type: 'custom',
  position: { x: 0, y: 0 },
  width: 100,
  height: 80,
  data: { type: BlockEnum.Code, title: 'Code', desc: '' },
  ...overrides,
}) as TestNode

describe('use-workflow-organize helpers', () => {
  it('filters top-level container nodes and computes size changes', () => {
    const containers = getLayoutContainerNodes([
      createNode({ id: 'loop', data: { type: BlockEnum.Loop } }),
      createNode({ id: 'iteration', data: { type: BlockEnum.Iteration } }),
      createNode({ id: 'nested-loop', parentId: 'loop', data: { type: BlockEnum.Loop } }),
      createNode({ id: 'code', data: { type: BlockEnum.Code } }),
    ])
    expect(containers.map(node => node.id)).toEqual(['loop', 'iteration'])

    const sizeChanges = getContainerSizeChanges(containers, {
      loop: {
        bounds: { minX: 10, minY: 20, maxX: 180, maxY: 150 },
        nodes: new Map([['child', { x: 10, y: 20, width: 50, height: 40 }]]),
      } as unknown as Parameters<typeof getContainerSizeChanges>[1][string],
    })
    expect(sizeChanges.loop).toEqual({ width: 290, height: 250 })
    expect(sizeChanges.iteration).toBeUndefined()
  })

  it('creates aligned layers and applies layout positions to root and child nodes', () => {
    const rootNodes = [
      createNode({ id: 'root-a' }),
      createNode({ id: 'root-b' }),
      createNode({ id: 'loop', data: { type: BlockEnum.Loop }, width: 200, height: 180 }),
      createNode({ id: 'loop-child', parentId: 'loop' }),
    ]
    const layout = {
      bounds: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
      nodes: new Map([
        ['root-a', { x: 10, y: 100, width: 120, height: 40, layer: 0 }],
        ['root-b', { x: 210, y: 120, width: 80, height: 80, layer: 0 }],
        ['loop', { x: 320, y: 40, width: 200, height: 180, layer: 1 }],
      ]),
    } as unknown as Parameters<typeof createLayerMap>[0]
    const childLayoutsMap = {
      loop: {
        bounds: { minX: 50, minY: 25, maxX: 180, maxY: 90 },
        nodes: new Map([['loop-child', { x: 100, y: 45, width: 80, height: 40 }]]),
      },
    } as unknown as Parameters<typeof applyLayoutToNodes>[0]['childLayoutsMap']

    const layerMap = createLayerMap(layout)
    expect(layerMap.get(0)).toEqual({ minY: 100, maxHeight: 80 })

    const resized = applyContainerSizeChanges(rootNodes, { loop: { width: 260, height: 220 } })
    expect(resized.find(node => node.id === 'loop')).toEqual(expect.objectContaining({
      width: 260,
      height: 220,
      data: expect.objectContaining({ width: 260, height: 220 }),
    }))

    const laidOut = applyLayoutToNodes({
      nodes: rootNodes,
      layout,
      parentNodes: [rootNodes[2]!],
      childLayoutsMap,
    })
    expect(laidOut.find(node => node.id === 'root-b')?.position).toEqual({ x: 210, y: 100 })
    expect(laidOut.find(node => node.id === 'loop-child')?.position).toEqual({ x: 110, y: 80 })
  })

  it('keeps original positions when layer or child layout data is missing', () => {
    const nodes = [
      createNode({ id: 'root-a', position: { x: 1, y: 2 } }),
      createNode({ id: 'root-b', position: { x: 3, y: 4 } }),
      createNode({ id: 'loop', data: { type: BlockEnum.Loop }, position: { x: 5, y: 6 } }),
      createNode({ id: 'loop-child', parentId: 'loop', position: { x: 7, y: 8 } }),
    ]
    const layout = {
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      nodes: new Map([
        ['root-a', { x: 20, y: 30, width: 50, height: 20 }],
      ]),
    } as unknown as Parameters<typeof applyLayoutToNodes>[0]['layout']

    const laidOut = applyLayoutToNodes({
      nodes,
      layout,
      parentNodes: [nodes[2]!],
      childLayoutsMap: {},
    })

    expect(laidOut.find(node => node.id === 'root-a')?.position).toEqual({ x: 20, y: 30 })
    expect(laidOut.find(node => node.id === 'root-b')?.position).toEqual({ x: 3, y: 4 })
    expect(laidOut.find(node => node.id === 'loop-child')?.position).toEqual({ x: 7, y: 8 })
  })
})
