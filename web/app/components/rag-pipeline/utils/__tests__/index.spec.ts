import type { Viewport } from 'reactflow'
import type { Node } from '@/app/components/workflow/types'
import { describe, expect, it, vi } from 'vitest'
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
  generateNewNode: ({ id, type, data, position }: { id: string, type?: string, data: object, position: { x: number, y: number } }) => ({
    newNode: { id, type: type || 'custom', data, position },
  }),
}))

describe('processNodesWithoutDataSource', () => {
  describe('when nodes contain DataSource', () => {
    it('should return original nodes and viewport unchanged', () => {
      const nodes: Node[] = [
        {
          id: 'node-1',
          type: 'custom',
          data: { type: BlockEnum.DataSource, title: 'Data Source' },
          position: { x: 100, y: 100 },
        } as Node,
        {
          id: 'node-2',
          type: 'custom',
          data: { type: BlockEnum.End, title: 'End' },
          position: { x: 500, y: 100 },
        } as Node,
      ]
      const viewport: Viewport = { x: 0, y: 0, zoom: 1 }

      const result = processNodesWithoutDataSource(nodes, viewport)

      expect(result.nodes).toBe(nodes)
      expect(result.viewport).toBe(viewport)
    })

    it('should check all nodes before returning early', () => {
      const nodes: Node[] = [
        {
          id: 'node-1',
          type: 'custom',
          data: { type: BlockEnum.Start, title: 'Start' },
          position: { x: 0, y: 0 },
        } as Node,
        {
          id: 'node-2',
          type: 'custom',
          data: { type: BlockEnum.DataSource, title: 'Data Source' },
          position: { x: 100, y: 100 },
        } as Node,
      ]

      const result = processNodesWithoutDataSource(nodes)

      expect(result.nodes).toBe(nodes)
    })
  })

  describe('when nodes do not contain DataSource', () => {
    it('should add data source empty node and note node for single custom node', () => {
      const nodes: Node[] = [
        {
          id: 'node-1',
          type: 'custom',
          data: { type: BlockEnum.KnowledgeBase, title: 'Knowledge Base' },
          position: { x: 500, y: 200 },
        } as Node,
      ]
      const viewport: Viewport = { x: 0, y: 0, zoom: 1 }

      const result = processNodesWithoutDataSource(nodes, viewport)

      expect(result.nodes.length).toBe(3)
      expect(result.nodes[0].id).toBe('data-source-empty')
      expect(result.nodes[1].id).toBe('note')
      expect(result.nodes[2]).toBe(nodes[0])
    })

    it('should use the leftmost custom node position for new nodes', () => {
      const nodes: Node[] = [
        {
          id: 'node-1',
          type: 'custom',
          data: { type: BlockEnum.KnowledgeBase, title: 'KB 1' },
          position: { x: 700, y: 100 },
        } as Node,
        {
          id: 'node-2',
          type: 'custom',
          data: { type: BlockEnum.End, title: 'End' },
          position: { x: 200, y: 100 }, // This is the leftmost
        } as Node,
        {
          id: 'node-3',
          type: 'custom',
          data: { type: BlockEnum.Start, title: 'Start' },
          position: { x: 500, y: 100 },
        } as Node,
      ]
      const viewport: Viewport = { x: 0, y: 0, zoom: 1 }

      const result = processNodesWithoutDataSource(nodes, viewport)

      expect(result.nodes[0].position.x).toBe(-200)
      expect(result.nodes[0].position.y).toBe(100)
    })

    it('should adjust viewport based on new node position', () => {
      const nodes: Node[] = [
        {
          id: 'node-1',
          type: 'custom',
          data: { type: BlockEnum.KnowledgeBase, title: 'KB' },
          position: { x: 300, y: 200 },
        } as Node,
      ]
      const viewport: Viewport = { x: 0, y: 0, zoom: 1 }

      const result = processNodesWithoutDataSource(nodes, viewport)

      expect(result.viewport).toEqual({
        x: 200,
        y: -100,
        zoom: 1,
      })
    })

    it('should apply zoom factor to viewport calculation', () => {
      const nodes: Node[] = [
        {
          id: 'node-1',
          type: 'custom',
          data: { type: BlockEnum.KnowledgeBase, title: 'KB' },
          position: { x: 300, y: 200 },
        } as Node,
      ]
      const viewport: Viewport = { x: 0, y: 0, zoom: 2 }

      const result = processNodesWithoutDataSource(nodes, viewport)

      expect(result.viewport).toEqual({
        x: 400,
        y: -200,
        zoom: 2,
      })
    })

    it('should use default zoom 1 when viewport zoom is undefined', () => {
      const nodes: Node[] = [
        {
          id: 'node-1',
          type: 'custom',
          data: { type: BlockEnum.KnowledgeBase, title: 'KB' },
          position: { x: 500, y: 100 },
        } as Node,
      ]

      const result = processNodesWithoutDataSource(nodes, undefined)

      expect(result.viewport?.zoom).toBe(1)
    })

    it('should add note node below data source empty node', () => {
      const nodes: Node[] = [
        {
          id: 'node-1',
          type: 'custom',
          data: { type: BlockEnum.KnowledgeBase, title: 'KB' },
          position: { x: 500, y: 100 },
        } as Node,
      ]

      const result = processNodesWithoutDataSource(nodes)

      const dataSourceEmptyNode = result.nodes[0]
      const noteNode = result.nodes[1]

      // Note node should be 100px below data source empty node
      expect(noteNode.position.x).toBe(dataSourceEmptyNode.position.x)
      expect(noteNode.position.y).toBe(dataSourceEmptyNode.position.y + 100)
    })

    it('should set correct data for data source empty node', () => {
      const nodes: Node[] = [
        {
          id: 'node-1',
          type: 'custom',
          data: { type: BlockEnum.KnowledgeBase, title: 'KB' },
          position: { x: 500, y: 100 },
        } as Node,
      ]

      const result = processNodesWithoutDataSource(nodes)

      expect(result.nodes[0].data.type).toBe(BlockEnum.DataSourceEmpty)
      expect(result.nodes[0].data._isTempNode).toBe(true)
      expect(result.nodes[0].data.width).toBe(240)
    })

    it('should set correct data for note node', () => {
      const nodes: Node[] = [
        {
          id: 'node-1',
          type: 'custom',
          data: { type: BlockEnum.KnowledgeBase, title: 'KB' },
          position: { x: 500, y: 100 },
        } as Node,
      ]

      const result = processNodesWithoutDataSource(nodes)

      const noteNode = result.nodes[1]
      const noteData = noteNode.data as Record<string, unknown>
      expect(noteData._isTempNode).toBe(true)
      expect(noteData.theme).toBe('blue')
      expect(noteData.width).toBe(240)
      expect(noteData.height).toBe(300)
      expect(noteData.showAuthor).toBe(true)
    })
  })

  describe('when nodes array is empty', () => {
    it('should return empty nodes array unchanged', () => {
      const nodes: Node[] = []
      const viewport: Viewport = { x: 0, y: 0, zoom: 1 }

      const result = processNodesWithoutDataSource(nodes, viewport)

      expect(result.nodes).toEqual([])
      expect(result.viewport).toBe(viewport)
    })
  })

  describe('when no custom nodes exist', () => {
    it('should return original nodes when only non-custom nodes', () => {
      const nodes: Node[] = [
        {
          id: 'node-1',
          type: 'special', // Not 'custom'
          data: { type: BlockEnum.Start, title: 'Start' },
          position: { x: 100, y: 100 },
        } as Node,
      ]
      const viewport: Viewport = { x: 0, y: 0, zoom: 1 }

      const result = processNodesWithoutDataSource(nodes, viewport)

      expect(result.nodes).toBe(nodes)
      expect(result.viewport).toBe(viewport)
    })
  })

  describe('edge cases', () => {
    it('should handle nodes with same x position', () => {
      const nodes: Node[] = [
        {
          id: 'node-1',
          type: 'custom',
          data: { type: BlockEnum.KnowledgeBase, title: 'KB 1' },
          position: { x: 300, y: 100 },
        } as Node,
        {
          id: 'node-2',
          type: 'custom',
          data: { type: BlockEnum.End, title: 'End' },
          position: { x: 300, y: 200 },
        } as Node,
      ]

      const result = processNodesWithoutDataSource(nodes)

      expect(result.nodes.length).toBe(4)
    })

    it('should handle negative positions', () => {
      const nodes: Node[] = [
        {
          id: 'node-1',
          type: 'custom',
          data: { type: BlockEnum.KnowledgeBase, title: 'KB' },
          position: { x: -100, y: -50 },
        } as Node,
      ]

      const result = processNodesWithoutDataSource(nodes)

      expect(result.nodes[0].position.x).toBe(-500)
      expect(result.nodes[0].position.y).toBe(-50)
    })

    it('should handle undefined viewport gracefully', () => {
      const nodes: Node[] = [
        {
          id: 'node-1',
          type: 'custom',
          data: { type: BlockEnum.KnowledgeBase, title: 'KB' },
          position: { x: 500, y: 100 },
        } as Node,
      ]

      const result = processNodesWithoutDataSource(nodes, undefined)

      expect(result.viewport).toBeDefined()
      expect(result.viewport?.zoom).toBe(1)
    })
  })
})

describe('module exports', () => {
  it('should export processNodesWithoutDataSource', () => {
    expect(processNodesWithoutDataSource).toBeDefined()
    expect(typeof processNodesWithoutDataSource).toBe('function')
  })
})
