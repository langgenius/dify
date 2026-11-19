import type { Viewport } from 'reactflow'
import type { Node } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { processNodesWithoutDataSource } from '../nodes'

describe('processNodesWithoutDataSource', () => {
  it('should return the original nodes when a datasource node already exists', () => {
    const nodes = [
      {
        id: 'node-1',
        type: 'custom',
        data: { type: BlockEnum.DataSource },
        position: { x: 100, y: 100 },
      },
    ] as Node[]
    const viewport: Viewport = { x: 0, y: 0, zoom: 1 }

    const result = processNodesWithoutDataSource(nodes, viewport)

    expect(result.nodes).toBe(nodes)
    expect(result.viewport).toBe(viewport)
  })

  it('should prepend datasource empty and note nodes when the pipeline starts without a datasource', () => {
    const nodes = [
      {
        id: 'node-1',
        type: 'custom',
        data: { type: BlockEnum.KnowledgeBase },
        position: { x: 300, y: 200 },
      },
    ] as Node[]

    const result = processNodesWithoutDataSource(nodes, { x: 0, y: 0, zoom: 2 })

    expect(result.nodes[0]).toEqual(
      expect.objectContaining({
        id: 'data-source-empty',
        type: 'custom-data-source-empty',
        position: { x: 0, y: 200 },
      }),
    )
    expect(result.nodes[1]).toEqual(
      expect.objectContaining({
        id: 'note',
        type: 'custom-note',
        position: { x: 0, y: 300 },
      }),
    )
    expect(result.viewport).toEqual({
      x: 160,
      y: 164,
      zoom: 2,
    })
  })

  it('should leave nodes unchanged when there is no custom node to anchor from', () => {
    const nodes = [
      {
        id: 'node-1',
        type: 'custom-note',
        data: { type: BlockEnum.Answer },
        position: { x: 100, y: 100 },
      },
    ] as Node[]

    const result = processNodesWithoutDataSource(nodes)

    expect(result.nodes).toBe(nodes)
    expect(result.viewport).toBeUndefined()
  })
})

it('anchors inserted nodes to the leftmost workflow node and preserves existing nodes', () => {
  const right = {
    id: 'right',
    type: 'custom',
    data: { type: BlockEnum.KnowledgeBase },
    position: { x: 700, y: 100 },
  } as Node
  const left = {
    id: 'left',
    type: 'custom',
    data: { type: BlockEnum.Code },
    position: { x: 200, y: 80 },
  } as Node
  const result = processNodesWithoutDataSource([right, left])
  expect(result.nodes[0]?.position).toEqual({ x: -100, y: 80 })
  expect(result.nodes.slice(2)).toEqual([right, left])
  expect(result.viewport).toEqual({ x: 180, y: 202, zoom: 1 })
})
