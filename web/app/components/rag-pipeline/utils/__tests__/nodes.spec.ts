import type { Viewport } from 'reactflow'
import type { Node } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { processNodesWithoutDataSource } from '../nodes'

vi.mock('@/app/components/workflow/constants', () => ({
  CUSTOM_NODE: 'custom',
  NODE_WIDTH_X_OFFSET: 400,
  START_INITIAL_POSITION: { x: 100, y: 100 },
}))

vi.mock('@/app/components/workflow/nodes/data-source-empty/constants', () => ({
  CUSTOM_DATA_SOURCE_EMPTY_NODE: 'data-source-empty',
}))

vi.mock('@/app/components/workflow/note-node/constants', () => ({
  CUSTOM_NOTE_NODE: 'note',
}))

vi.mock('@/app/components/workflow/note-node/types', () => ({
  NoteTheme: { blue: 'blue' },
}))

vi.mock('@/app/components/workflow/utils', () => ({
  generateNewNode: ({ id, type, data, position }: { id: string, type: string, data: object, position: { x: number, y: number } }) => ({
    newNode: { id, type, data, position },
  }),
}))

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

    expect(result.nodes[0]).toEqual(expect.objectContaining({
      id: 'data-source-empty',
      type: 'data-source-empty',
      position: { x: -100, y: 200 },
    }))
    expect(result.nodes[1]).toEqual(expect.objectContaining({
      id: 'note',
      type: 'note',
      position: { x: -100, y: 300 },
    }))
    expect(result.viewport).toEqual({
      x: 400,
      y: -200,
      zoom: 2,
    })
  })

  it('should leave nodes unchanged when there is no custom node to anchor from', () => {
    const nodes = [
      {
        id: 'node-1',
        type: 'note',
        data: { type: BlockEnum.Answer },
        position: { x: 100, y: 100 },
      },
    ] as Node[]

    const result = processNodesWithoutDataSource(nodes)

    expect(result.nodes).toBe(nodes)
    expect(result.viewport).toBeUndefined()
  })
})
