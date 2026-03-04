import { renderHook } from '@testing-library/react'
import { BlockEnum } from '../../types'
import { useAvailableBlocks } from '../use-available-blocks'

const mockNodeTypes = [
  BlockEnum.Start,
  BlockEnum.End,
  BlockEnum.LLM,
  BlockEnum.Code,
  BlockEnum.IfElse,
  BlockEnum.Iteration,
  BlockEnum.Loop,
  BlockEnum.Tool,
  BlockEnum.DataSource,
  BlockEnum.KnowledgeBase,
  BlockEnum.HumanInput,
  BlockEnum.LoopEnd,
]

vi.mock('../use-nodes-meta-data', () => ({
  useNodesMetaData: () => ({
    nodes: mockNodeTypes.map(type => ({ metaData: { type } })),
    nodesMap: {},
  }),
}))

describe('useAvailableBlocks', () => {
  describe('availablePrevBlocks', () => {
    it('should return empty array when nodeType is undefined', () => {
      const { result } = renderHook(() => useAvailableBlocks(undefined))
      expect(result.current.availablePrevBlocks).toEqual([])
    })

    it('should return empty array for Start node', () => {
      const { result } = renderHook(() => useAvailableBlocks(BlockEnum.Start))
      expect(result.current.availablePrevBlocks).toEqual([])
    })

    it('should return empty array for trigger nodes', () => {
      for (const trigger of [BlockEnum.TriggerPlugin, BlockEnum.TriggerWebhook, BlockEnum.TriggerSchedule]) {
        const { result } = renderHook(() => useAvailableBlocks(trigger))
        expect(result.current.availablePrevBlocks).toEqual([])
      }
    })

    it('should return empty array for DataSource node', () => {
      const { result } = renderHook(() => useAvailableBlocks(BlockEnum.DataSource))
      expect(result.current.availablePrevBlocks).toEqual([])
    })

    it('should return all available nodes for regular block types', () => {
      const { result } = renderHook(() => useAvailableBlocks(BlockEnum.LLM))
      expect(result.current.availablePrevBlocks.length).toBeGreaterThan(0)
      expect(result.current.availablePrevBlocks).toContain(BlockEnum.Code)
    })
  })

  describe('availableNextBlocks', () => {
    it('should return empty array when nodeType is undefined', () => {
      const { result } = renderHook(() => useAvailableBlocks(undefined))
      expect(result.current.availableNextBlocks).toEqual([])
    })

    it('should return empty array for End node', () => {
      const { result } = renderHook(() => useAvailableBlocks(BlockEnum.End))
      expect(result.current.availableNextBlocks).toEqual([])
    })

    it('should return empty array for LoopEnd node', () => {
      const { result } = renderHook(() => useAvailableBlocks(BlockEnum.LoopEnd))
      expect(result.current.availableNextBlocks).toEqual([])
    })

    it('should return empty array for KnowledgeBase node', () => {
      const { result } = renderHook(() => useAvailableBlocks(BlockEnum.KnowledgeBase))
      expect(result.current.availableNextBlocks).toEqual([])
    })

    it('should return all available nodes for regular block types', () => {
      const { result } = renderHook(() => useAvailableBlocks(BlockEnum.LLM))
      expect(result.current.availableNextBlocks.length).toBeGreaterThan(0)
    })
  })

  describe('inContainer filtering', () => {
    it('should exclude Iteration, Loop, End, DataSource, KnowledgeBase, HumanInput when inContainer=true', () => {
      const { result } = renderHook(() => useAvailableBlocks(BlockEnum.LLM, true))

      expect(result.current.availableNextBlocks).not.toContain(BlockEnum.Iteration)
      expect(result.current.availableNextBlocks).not.toContain(BlockEnum.Loop)
      expect(result.current.availableNextBlocks).not.toContain(BlockEnum.End)
      expect(result.current.availableNextBlocks).not.toContain(BlockEnum.DataSource)
      expect(result.current.availableNextBlocks).not.toContain(BlockEnum.KnowledgeBase)
      expect(result.current.availableNextBlocks).not.toContain(BlockEnum.HumanInput)
    })

    it('should exclude LoopEnd when not in container', () => {
      const { result } = renderHook(() => useAvailableBlocks(BlockEnum.LLM, false))
      expect(result.current.availableNextBlocks).not.toContain(BlockEnum.LoopEnd)
    })
  })

  describe('getAvailableBlocks callback', () => {
    it('should return prev and next blocks for a given node type', () => {
      const { result } = renderHook(() => useAvailableBlocks(BlockEnum.LLM))
      const blocks = result.current.getAvailableBlocks(BlockEnum.Code)

      expect(blocks.availablePrevBlocks.length).toBeGreaterThan(0)
      expect(blocks.availableNextBlocks.length).toBeGreaterThan(0)
    })

    it('should return empty prevBlocks for Start node', () => {
      const { result } = renderHook(() => useAvailableBlocks(BlockEnum.LLM))
      const blocks = result.current.getAvailableBlocks(BlockEnum.Start)

      expect(blocks.availablePrevBlocks).toEqual([])
    })

    it('should return empty prevBlocks for DataSource node', () => {
      const { result } = renderHook(() => useAvailableBlocks(BlockEnum.LLM))
      const blocks = result.current.getAvailableBlocks(BlockEnum.DataSource)

      expect(blocks.availablePrevBlocks).toEqual([])
    })

    it('should return empty nextBlocks for End/LoopEnd/KnowledgeBase', () => {
      const { result } = renderHook(() => useAvailableBlocks(BlockEnum.LLM))

      expect(result.current.getAvailableBlocks(BlockEnum.End).availableNextBlocks).toEqual([])
      expect(result.current.getAvailableBlocks(BlockEnum.LoopEnd).availableNextBlocks).toEqual([])
      expect(result.current.getAvailableBlocks(BlockEnum.KnowledgeBase).availableNextBlocks).toEqual([])
    })

    it('should filter by inContainer when provided', () => {
      const { result } = renderHook(() => useAvailableBlocks(BlockEnum.LLM))
      const blocks = result.current.getAvailableBlocks(BlockEnum.Code, true)

      expect(blocks.availableNextBlocks).not.toContain(BlockEnum.Iteration)
      expect(blocks.availableNextBlocks).not.toContain(BlockEnum.Loop)
    })
  })
})
