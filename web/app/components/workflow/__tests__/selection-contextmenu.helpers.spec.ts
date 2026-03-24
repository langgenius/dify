import {
  alignNodePosition,
  AlignType,
  distributeNodes,
  getAlignableNodes,
  getAlignBounds,
  getMenuPosition,
} from '../selection-contextmenu.helpers'
import { createNode } from './fixtures'

describe('selection-contextmenu helpers', () => {
  it('should keep the menu inside the workflow container bounds', () => {
    expect(getMenuPosition(undefined, { width: 800, height: 600 })).toEqual({
      left: 0,
      top: 0,
    })
    expect(getMenuPosition({ left: 780, top: 590 }, { width: 800, height: 600 })).toEqual({
      left: 540,
      top: 210,
    })
    expect(getMenuPosition({ left: -10, top: -20 }, { width: 800, height: 600 })).toEqual({
      left: 0,
      top: 0,
    })
  })

  it('should exclude child nodes when their container node is selected', () => {
    const container = createNode({
      id: 'container',
      selected: true,
      data: {
        _children: [{ nodeId: 'child', nodeType: 'code' as never }],
      },
    })
    const child = createNode({ id: 'child', selected: true })
    const other = createNode({ id: 'other', selected: true })

    expect(getAlignableNodes([container, child, other], [container, child, other]).map(node => node.id)).toEqual([
      'container',
      'other',
    ])
  })

  it('should calculate bounds and align nodes by type', () => {
    const leftNode = createNode({
      id: 'left',
      position: { x: 10, y: 30 },
      positionAbsolute: { x: 10, y: 30 },
      width: 40,
      height: 20,
    })
    const rightNode = createNode({
      id: 'right',
      position: { x: 100, y: 70 },
      positionAbsolute: { x: 100, y: 70 },
      width: 60,
      height: 40,
    })
    const bounds = getAlignBounds([leftNode, rightNode])

    expect(bounds).toEqual({
      minX: 10,
      maxX: 160,
      minY: 30,
      maxY: 110,
    })

    alignNodePosition(rightNode, rightNode, AlignType.Left, bounds!)
    expect(rightNode.position.x).toBe(10)

    alignNodePosition(rightNode, rightNode, AlignType.Center, bounds!)
    expect(rightNode.position.x).toBe(55)

    alignNodePosition(rightNode, rightNode, AlignType.Right, bounds!)
    expect(rightNode.position.x).toBe(100)

    alignNodePosition(leftNode, leftNode, AlignType.Top, bounds!)
    expect(leftNode.position.y).toBe(30)

    alignNodePosition(leftNode, leftNode, AlignType.Middle, bounds!)
    expect(leftNode.position.y).toBe(60)
    expect(leftNode.positionAbsolute?.y).toBe(60)

    alignNodePosition(leftNode, leftNode, AlignType.Bottom, bounds!)
    expect(leftNode.position.y).toBe(90)
    expect(leftNode.positionAbsolute?.y).toBe(90)
  })

  it('should distribute nodes horizontally and vertically', () => {
    const first = createNode({ id: 'first', position: { x: 0, y: 0 }, width: 20, height: 20 })
    const middle = createNode({ id: 'middle', position: { x: 100, y: 80 }, width: 20, height: 20 })
    const last = createNode({ id: 'last', position: { x: 300, y: 200 }, width: 20, height: 20 })

    const horizontal = distributeNodes([first, middle, last], [first, middle, last], AlignType.DistributeHorizontal)
    expect(horizontal?.find(node => node.id === 'middle')?.position.x).toBe(150)

    const vertical = distributeNodes([first, middle, last], [first, middle, last], AlignType.DistributeVertical)
    expect(vertical?.find(node => node.id === 'middle')?.position.y).toBe(100)
  })

  it('should return null when nodes cannot be evenly distributed', () => {
    const first = createNode({ id: 'first', position: { x: 0, y: 0 }, width: 100, height: 100 })
    const middle = createNode({ id: 'middle', position: { x: 50, y: 50 }, width: 100, height: 100 })
    const last = createNode({ id: 'last', position: { x: 120, y: 120 }, width: 100, height: 100 })

    expect(distributeNodes([first, middle, last], [first, middle, last], AlignType.DistributeHorizontal)).toBeNull()
    expect(distributeNodes([first, middle], [first, middle], AlignType.DistributeVertical)).toBeNull()
    expect(getAlignBounds([first])).toBeNull()
  })

  it('should skip missing draft nodes and keep absolute positions in vertical distribution', () => {
    const first = createNode({ id: 'first', position: { x: 0, y: 0 }, width: 20, height: 20 })
    const middle = createNode({
      id: 'middle',
      position: { x: 0, y: 60 },
      positionAbsolute: { x: 0, y: 60 },
      width: 20,
      height: 20,
    })
    const last = createNode({ id: 'last', position: { x: 0, y: 180 }, width: 20, height: 20 })

    const distributed = distributeNodes(
      [first, middle, last],
      [first, last],
      AlignType.DistributeVertical,
    )
    expect(distributed).toEqual([first, last])

    const distributedWithMiddle = distributeNodes(
      [first, middle, last],
      [first, middle, last],
      AlignType.DistributeVertical,
    )
    expect(distributedWithMiddle?.find(node => node.id === 'middle')?.positionAbsolute?.y).toBe(90)
  })
})
