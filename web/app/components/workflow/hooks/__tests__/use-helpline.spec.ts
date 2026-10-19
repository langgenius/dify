import type { Node } from '../../types'
import { resetReactFlowMockState, rfState } from '../../__tests__/reactflow-mock-state'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import { useHelpline } from '../use-helpline'

vi.mock('reactflow', async () =>
  (await import('../../__tests__/reactflow-mock-state')).createReactFlowModuleMock(),
)

const makeNode = (id: string, x: number, y: number, overrides: Partial<Node> = {}): Node => ({
  id,
  position: { x, y },
  width: 240,
  height: 100,
  data: { type: BlockEnum.LLM, title: id, desc: '' },
  ...overrides,
})

describe('useHelpline', () => {
  beforeEach(resetReactFlowMockState)

  it('aligns within the threshold, excluding the dragged node and nested nodes', () => {
    const dragging = makeNode('dragging', 100, 100)
    rfState.nodes = [
      dragging,
      makeNode('horizontal', 300, 104),
      makeNode('vertical', 96, 300),
      makeNode('horizontal-boundary', 600, 105),
      makeNode('vertical-boundary', 95, 600),
      makeNode('iteration-child', 100, 100, { data: { ...dragging.data, isInIteration: true } }),
      makeNode('loop-child', 100, 100, { data: { ...dragging.data, isInLoop: true } }),
    ]
    const { result } = renderWorkflowHook(() => useHelpline())

    const aligned = result.current.handleSetHelpline(dragging)

    expect(aligned.showHorizontalHelpLineNodes.map((node) => node.id)).toEqual(['horizontal'])
    expect(aligned.showVerticalHelpLineNodes.map((node) => node.id)).toEqual(['vertical'])
  })

  it.each([BlockEnum.Start, BlockEnum.TriggerWebhook])(
    'aligns the inner content of %s entry nodes',
    (type) => {
      const entry = makeNode('entry', 100, 100)
      entry.data.type = type
      rfState.nodes = [entry, makeNode('aligned', 400, 121), makeNode('wrapper', 700, 100)]
      const { result, store } = renderWorkflowHook(() => useHelpline())

      const aligned = result.current.handleSetHelpline(entry)

      expect(aligned.showHorizontalHelpLineNodes.map((node) => node.id)).toEqual(['aligned'])
      expect(store.getState().helpLineHorizontal).toEqual({ top: 121, left: 100, width: 540 })
    },
  )

  it.each([
    { x: 100, left: 100, width: 1000 },
    { x: 900, left: 300, width: 840 },
  ])('spans every aligned node when dragging to x=$x', ({ x, left, width }) => {
    rfState.nodes = [makeNode('wide', 300, 100, { width: 800 }), makeNode('far', 600, 100)]
    const { result, store } = renderWorkflowHook(() => useHelpline())

    result.current.handleSetHelpline(makeNode('dragging', x, 100))

    expect(store.getState().helpLineHorizontal).toEqual({ top: 100, left, width })
  })

  it.each([
    { y: 0, top: 0, height: 600 },
    { y: 700, top: 100, height: 700 },
  ])(
    'spans vertical nodes regardless of input order when dragging to y=$y',
    ({ y, top, height }) => {
      rfState.nodes = [makeNode('lower', 120, 300), makeNode('tall', 120, 100, { height: 500 })]
      const { result, store } = renderWorkflowHook(() => useHelpline())

      const aligned = result.current.handleSetHelpline(makeNode('dragging', 120, y))

      expect(aligned.showVerticalHelpLineNodes.map((node) => node.id)).toEqual(['tall', 'lower'])
      expect(store.getState().helpLineVertical).toEqual({ top, left: 120, height })
    },
  )

  it('excludes the entry wrapper from the vertical line extent', () => {
    const entry = makeNode('entry', 120, 400)
    entry.data.type = BlockEnum.Start
    rfState.nodes = [makeNode('aligned', 120, 100)]
    const { result, store } = renderWorkflowHook(() => useHelpline())

    result.current.handleSetHelpline(entry)

    expect(store.getState().helpLineVertical).toEqual({ top: 100, left: 120, height: 400 })
  })

  it.each(['outside', 'iteration', 'loop'] as const)(
    'clears existing lines when dragging %s',
    (destination) => {
      const dragging = makeNode('dragging', 100, 100)
      rfState.nodes = [makeNode('aligned', 100, 100)]
      const { result, store } = renderWorkflowHook(() => useHelpline())
      result.current.handleSetHelpline(dragging)
      expect(store.getState().helpLineHorizontal).toEqual({ top: 100, left: 100, width: 240 })
      expect(store.getState().helpLineVertical).toEqual({ top: 100, left: 100, height: 100 })

      if (destination === 'outside') dragging.position = { x: 500, y: 500 }
      else if (destination === 'iteration') dragging.data.isInIteration = true
      else dragging.data.isInLoop = true
      const aligned = result.current.handleSetHelpline(dragging)

      expect(aligned).toEqual({ showHorizontalHelpLineNodes: [], showVerticalHelpLineNodes: [] })
      expect(store.getState().helpLineHorizontal).toBeUndefined()
      expect(store.getState().helpLineVertical).toBeUndefined()
    },
  )
})
