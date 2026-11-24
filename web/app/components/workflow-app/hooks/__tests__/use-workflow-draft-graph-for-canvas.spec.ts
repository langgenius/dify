import type { Node } from '@/app/components/workflow/types'
import { renderHook } from '@testing-library/react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum } from '@/app/components/workflow/types'
import { useWorkflowDraftGraphForCanvas } from '../use-workflow-draft-graph-for-canvas'

describe('useWorkflowDraftGraphForCanvas', () => {
  it('should restore a local start placeholder for workflow graphs without an entry node', () => {
    const { result } = renderHook(() => useWorkflowDraftGraphForCanvas('workflow'))

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
    const node = createNode({ id: 'entry', data: { type } })
    const { result } = renderHook(() => useWorkflowDraftGraphForCanvas('workflow'))

    const graph = result.current.getWorkflowDraftGraphForCanvas({
      nodes: [node],
      edges: [],
    })

    expect(graph.nodes).toEqual([node])
  })

  it('should not restore a start placeholder for non-workflow app modes', () => {
    const { result } = renderHook(() => useWorkflowDraftGraphForCanvas('advanced-chat'))

    const graph = result.current.getWorkflowDraftGraphForCanvas({
      nodes: [],
      edges: [],
    })

    expect(graph.nodes).toEqual([])
  })

  it('should reuse the provided local start placeholder template when available', () => {
    const localStartPlaceholder = createNode({
      id: 'start-placeholder',
      data: { type: BlockEnum.StartPlaceholder },
    })
    const draftNode = createNode({ id: 'llm', data: { type: BlockEnum.LLM } })
    const { result } = renderHook(() => useWorkflowDraftGraphForCanvas('workflow'))

    const graph = result.current.getWorkflowDraftGraphForCanvas(
      {
        nodes: [draftNode],
        edges: [],
        viewport: { x: 1, y: 2, zoom: 0.5 },
      },
      {
        localStartPlaceholderNodes: [localStartPlaceholder],
      },
    )

    expect(graph.nodes).toEqual([localStartPlaceholder, draftNode])
    expect(graph.viewport).toEqual({ x: 1, y: 2, zoom: 0.5 })
  })

  it('removes residual LLM memory from workflow drafts, including container children', () => {
    const memory = {
      enabled: false,
      role_prefix: { user: '', assistant: '' },
      window: { enabled: false, size: 10 },
    }
    const nodes: Node<{ memory?: typeof memory }>[] = [
      {
        id: 'start',
        position: { x: 0, y: 0 },
        data: { type: BlockEnum.Start, title: 'Start', desc: '' },
      },
      ...[undefined, 'iteration', 'loop'].map((parentId, index) => ({
        id: `llm-${index}`,
        parentId,
        position: { x: 100, y: index * 100 },
        data: { type: BlockEnum.LLM, title: 'LLM', desc: '', memory },
      })),
      ...[BlockEnum.Iteration, BlockEnum.Loop].map((type) => ({
        id: type,
        position: { x: 200, y: 0 },
        data: { type, title: type, desc: '' },
      })),
      {
        id: 'classifier',
        position: { x: 300, y: 0 },
        data: { type: BlockEnum.QuestionClassifier, title: 'Classifier', desc: '', memory },
      },
    ]
    const originalNodes = structuredClone(nodes)
    const { result } = renderHook(() => useWorkflowDraftGraphForCanvas('workflow'))

    const graph = result.current.getWorkflowDraftGraphForCanvas({ nodes, edges: [] })

    expect(graph.nodes).toHaveLength(nodes.length)
    const llmNodes = graph.nodes.filter((node) => node.data.type === BlockEnum.LLM)
    expect(llmNodes).toHaveLength(3)
    llmNodes.forEach((node) => {
      expect(node.data).not.toHaveProperty('memory')
      expect(node).toMatchObject({
        parentId: originalNodes.find((original) => original.id === node.id)?.parentId,
        data: { type: BlockEnum.LLM, title: 'LLM', desc: '' },
      })
    })
    expect(graph.nodes.find((node) => node.id === 'classifier')).toEqual(originalNodes.at(-1))
    expect(nodes).toEqual(originalNodes)
  })

  it.each(['advanced-chat', undefined] as const)(
    'preserves memory when app mode is %s',
    (appMode) => {
      const nodes: Node<{ memory: { window: { enabled: boolean; size: number } } }>[] = [
        {
          id: 'llm',
          position: { x: 0, y: 0 },
          data: {
            type: BlockEnum.LLM,
            title: 'LLM',
            desc: '',
            memory: { window: { enabled: false, size: 10 } },
          },
        },
      ]
      const { result } = renderHook(() => useWorkflowDraftGraphForCanvas(appMode))

      const graph = result.current.getWorkflowDraftGraphForCanvas({ nodes, edges: [] })

      expect(graph.nodes).toEqual(nodes)
    },
  )
})
