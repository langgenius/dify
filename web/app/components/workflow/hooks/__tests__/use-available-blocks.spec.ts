import type { NodeDefault } from '../../types'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { BlockClassification } from '../../block-selector/types'
import { BlockEnum } from '../../types'
import { useAvailableBlocks } from '../use-available-blocks'

const mockNodeTypes = [
  BlockEnum.Start,
  BlockEnum.StartPlaceholder,
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
      classification: BlockClassification.Default,
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

const outside = [
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
]
const inside = [
  BlockEnum.Start,
  BlockEnum.LLM,
  BlockEnum.Code,
  BlockEnum.IfElse,
  BlockEnum.Tool,
  BlockEnum.HumanInput,
  BlockEnum.LoopEnd,
]

it.each([
  undefined,
  BlockEnum.Start,
  BlockEnum.StartPlaceholder,
  BlockEnum.DataSource,
  BlockEnum.TriggerPlugin,
  BlockEnum.TriggerWebhook,
  BlockEnum.TriggerSchedule,
])('disallows predecessors for entry node %s in both APIs', (type) => {
  const { result } = renderWorkflowHook(() => useAvailableBlocks(type), { hooksStoreProps })
  expect(result.current.availablePrevBlocks).toEqual([])
  expect(result.current.getAvailableBlocks(type).availablePrevBlocks).toEqual([])
})
it.each([undefined, BlockEnum.StartPlaceholder, BlockEnum.LoopEnd, BlockEnum.KnowledgeBase])(
  'disallows successors for terminal node %s in both APIs',
  (type) => {
    const { result } = renderWorkflowHook(() => useAvailableBlocks(type), { hooksStoreProps })
    expect(result.current.availableNextBlocks).toEqual([])
    expect(result.current.getAvailableBlocks(type).availableNextBlocks).toEqual([])
  },
)
it.each([false, true])('filters both APIs consistently for container=%s', (inContainer) => {
  const { result } = renderWorkflowHook(() => useAvailableBlocks(BlockEnum.LLM, inContainer), {
    hooksStoreProps,
  })
  const expected = inContainer ? inside : outside
  expect(result.current.availablePrevBlocks).toEqual(expected)
  expect(result.current.availableNextBlocks).toEqual(expected)
  expect(result.current.getAvailableBlocks(BlockEnum.Code, inContainer)).toEqual({
    availablePrevBlocks: expected,
    availableNextBlocks: expected,
  })
  expect(result.current.getAvailableBlocks(BlockEnum.End, inContainer).availableNextBlocks).toEqual(
    expected,
  )
})
