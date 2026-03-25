import type { NodeDefault } from '../../types'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { BlockClassificationEnum } from '../../block-selector/types'
import { BlockEnum } from '../../types'
import { useAvailableBlocks } from '../use-available-blocks'

// Transitive imports of use-nodes-meta-data.ts — only useNodeMetaData uses these
vi.mock('@/service/use-tools', async () =>
  (await import('../../__tests__/service-mock-factory')).createToolServiceMock())
vi.mock('@/context/i18n', () => ({ useGetLanguage: () => 'en' }))

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

function createNodeDefault(type: BlockEnum): NodeDefault {
  return {
    metaData: {
      classification: BlockClassificationEnum.Default,
      sort: 0,
      type,
      title: type,
      author: 'test',
    },
    defaultValue: {},
    checkValid: () => ({ isValid: true }),
  }
}

const hooksStoreProps = {
  availableNodesMetaData: {
    nodes: mockNodeTypes.map(createNodeDefault),
  },
}

describe('useAvailableBlocks', () => {
  describe('availablePrevBlocks', () => {
    it('should return empty array when nodeType is undefined', () => {
      const { result } = renderWorkflowHook(() => useAvailableBlocks(undefined), { hooksStoreProps })
      expect(result.current.availablePrevBlocks).toEqual([])
    })

    it('should return empty array for Start node', () => {
      const { result } = renderWorkflowHook(() => useAvailableBlocks(BlockEnum.Start), { hooksStoreProps })
      expect(result.current.availablePrevBlocks).toEqual([])
    })

    it('should return empty array for trigger nodes', () => {
      for (const trigger of [BlockEnum.TriggerPlugin, BlockEnum.TriggerWebhook, BlockEnum.TriggerSchedule]) {
        const { result } = renderWorkflowHook(() => useAvailableBlocks(trigger), { hooksStoreProps })
        expect(result.current.availablePrevBlocks).toEqual([])
      }
    })

    it('should return empty array for DataSource node', () => {
      const { result } = renderWorkflowHook(() => useAvailableBlocks(BlockEnum.DataSource), { hooksStoreProps })
      expect(result.current.availablePrevBlocks).toEqual([])
    })

    it('should return all available nodes for regular block types', () => {
      const { result } = renderWorkflowHook(() => useAvailableBlocks(BlockEnum.LLM), { hooksStoreProps })
      expect(result.current.availablePrevBlocks.length).toBeGreaterThan(0)
      expect(result.current.availablePrevBlocks).toContain(BlockEnum.Code)
    })
  })

  describe('availableNextBlocks', () => {
    it('should return empty array when nodeType is undefined', () => {
      const { result } = renderWorkflowHook(() => useAvailableBlocks(undefined), { hooksStoreProps })
      expect(result.current.availableNextBlocks).toEqual([])
    })

    it('should return empty array for End node', () => {
      const { result } = renderWorkflowHook(() => useAvailableBlocks(BlockEnum.End), { hooksStoreProps })
      expect(result.current.availableNextBlocks).toEqual([])
    })

    it('should return empty array for LoopEnd node', () => {
      const { result } = renderWorkflowHook(() => useAvailableBlocks(BlockEnum.LoopEnd), { hooksStoreProps })
      expect(result.current.availableNextBlocks).toEqual([])
    })

    it('should return empty array for KnowledgeBase node', () => {
      const { result } = renderWorkflowHook(() => useAvailableBlocks(BlockEnum.KnowledgeBase), { hooksStoreProps })
      expect(result.current.availableNextBlocks).toEqual([])
    })

    it('should return all available nodes for regular block types', () => {
      const { result } = renderWorkflowHook(() => useAvailableBlocks(BlockEnum.LLM), { hooksStoreProps })
      expect(result.current.availableNextBlocks.length).toBeGreaterThan(0)
    })
  })

  describe('inContainer filtering', () => {
    it('should exclude Iteration, Loop, End, DataSource, KnowledgeBase, HumanInput when inContainer=true', () => {
      const { result } = renderWorkflowHook(() => useAvailableBlocks(BlockEnum.LLM, true), { hooksStoreProps })

      expect(result.current.availableNextBlocks).not.toContain(BlockEnum.Iteration)
      expect(result.current.availableNextBlocks).not.toContain(BlockEnum.Loop)
      expect(result.current.availableNextBlocks).not.toContain(BlockEnum.End)
      expect(result.current.availableNextBlocks).not.toContain(BlockEnum.DataSource)
      expect(result.current.availableNextBlocks).not.toContain(BlockEnum.KnowledgeBase)
      expect(result.current.availableNextBlocks).not.toContain(BlockEnum.HumanInput)
    })

    it('should exclude LoopEnd when not in container', () => {
      const { result } = renderWorkflowHook(() => useAvailableBlocks(BlockEnum.LLM, false), { hooksStoreProps })
      expect(result.current.availableNextBlocks).not.toContain(BlockEnum.LoopEnd)
    })
  })

  describe('getAvailableBlocks callback', () => {
    it('should return prev and next blocks for a given node type', () => {
      const { result } = renderWorkflowHook(() => useAvailableBlocks(BlockEnum.LLM), { hooksStoreProps })
      const blocks = result.current.getAvailableBlocks(BlockEnum.Code)

      expect(blocks.availablePrevBlocks.length).toBeGreaterThan(0)
      expect(blocks.availableNextBlocks.length).toBeGreaterThan(0)
    })

    it('should return empty prevBlocks for Start node', () => {
      const { result } = renderWorkflowHook(() => useAvailableBlocks(BlockEnum.LLM), { hooksStoreProps })
      const blocks = result.current.getAvailableBlocks(BlockEnum.Start)

      expect(blocks.availablePrevBlocks).toEqual([])
    })

    it('should return empty prevBlocks for DataSource node', () => {
      const { result } = renderWorkflowHook(() => useAvailableBlocks(BlockEnum.LLM), { hooksStoreProps })
      const blocks = result.current.getAvailableBlocks(BlockEnum.DataSource)

      expect(blocks.availablePrevBlocks).toEqual([])
    })

    it('should return empty nextBlocks for End/LoopEnd/KnowledgeBase', () => {
      const { result } = renderWorkflowHook(() => useAvailableBlocks(BlockEnum.LLM), { hooksStoreProps })

      expect(result.current.getAvailableBlocks(BlockEnum.End).availableNextBlocks).toEqual([])
      expect(result.current.getAvailableBlocks(BlockEnum.LoopEnd).availableNextBlocks).toEqual([])
      expect(result.current.getAvailableBlocks(BlockEnum.KnowledgeBase).availableNextBlocks).toEqual([])
    })

    it('should filter by inContainer when provided', () => {
      const { result } = renderWorkflowHook(() => useAvailableBlocks(BlockEnum.LLM), { hooksStoreProps })
      const blocks = result.current.getAvailableBlocks(BlockEnum.Code, true)

      expect(blocks.availableNextBlocks).not.toContain(BlockEnum.Iteration)
      expect(blocks.availableNextBlocks).not.toContain(BlockEnum.Loop)
    })
  })
})
