import { renderHook } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { AppModeEnum } from '@/types/app'
import { useWorkflowDraftGraphForCanvas } from '../use-workflow-draft-graph-for-canvas'

let generateNewNodeCalls: Array<Record<string, unknown>> = []

vi.mock('@/app/components/workflow/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/workflow/utils')>()
  return {
    ...actual,
    generateNewNode: (args: { data: Record<string, unknown>, position: Record<string, unknown> }) => {
      generateNewNodeCalls.push(args)
      return {
        newNode: {
          id: `generated-${generateNewNodeCalls.length}`,
          type: 'custom',
          data: args.data,
          position: args.position,
        },
      }
    },
  }
})

describe('useWorkflowDraftGraphForCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateNewNodeCalls = []
  })

  it('should restore a local start placeholder for workflow graphs without an entry node', () => {
    const { result } = renderHook(() => useWorkflowDraftGraphForCanvas(AppModeEnum.WORKFLOW))

    const graph = result.current.getWorkflowDraftGraphForCanvas({
      nodes: [],
      edges: [],
    })

    expect(graph).toMatchObject({
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    })
    expect(graph.nodes).toHaveLength(1)
    expect(graph.nodes[0]).toMatchObject({
      data: {
        type: BlockEnum.StartPlaceholder,
        title: 'workflow.blocks.start-placeholder',
        desc: '',
        selected: true,
      },
    })
  })

  it.each([
    BlockEnum.Start,
    BlockEnum.TriggerSchedule,
    BlockEnum.TriggerWebhook,
    BlockEnum.TriggerPlugin,
    BlockEnum.StartPlaceholder,
  ])('should preserve existing %s entry nodes', (type) => {
    const node = { id: 'entry', data: { type } }
    const { result } = renderHook(() => useWorkflowDraftGraphForCanvas(AppModeEnum.WORKFLOW))

    const graph = result.current.getWorkflowDraftGraphForCanvas({
      nodes: [node] as never,
      edges: [],
    })

    expect(graph.nodes).toEqual([node])
    expect(generateNewNodeCalls).toHaveLength(0)
  })

  it('should not restore a start placeholder for non-workflow app modes', () => {
    const { result } = renderHook(() => useWorkflowDraftGraphForCanvas(AppModeEnum.ADVANCED_CHAT))

    const graph = result.current.getWorkflowDraftGraphForCanvas({
      nodes: [],
      edges: [],
    })

    expect(graph.nodes).toEqual([])
    expect(generateNewNodeCalls).toHaveLength(0)
  })

  it('should reuse the provided local start placeholder template when available', () => {
    const localStartPlaceholder = { id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } }
    const draftNode = { id: 'llm', data: { type: BlockEnum.LLM } }
    const { result } = renderHook(() => useWorkflowDraftGraphForCanvas(AppModeEnum.WORKFLOW))

    const graph = result.current.getWorkflowDraftGraphForCanvas({
      nodes: [draftNode] as never,
      edges: [],
      viewport: { x: 1, y: 2, zoom: 0.5 },
    }, {
      localStartPlaceholderNodes: [localStartPlaceholder] as never,
    })

    expect(graph.nodes).toEqual([localStartPlaceholder, draftNode])
    expect(graph.viewport).toEqual({ x: 1, y: 2, zoom: 0.5 })
    expect(generateNewNodeCalls).toHaveLength(0)
  })
})
