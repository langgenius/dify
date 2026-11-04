import type { AppMode } from '@dify/contracts/api/console/apps/types.gen'
import { renderEditorHook as renderHookWithConsoleQuery } from '@/app/components/workflow/editor-resource/__tests__/render'
import { createConsoleQueryClient, seedAppDetail } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { useWorkflowTemplate } from '../use-workflow-template'

const renderTemplateHook = (mode: AppMode) => {
  const queryClient = createConsoleQueryClient()
  seedAppDetail(queryClient, createAppDetailFixture({ id: 'app-1', mode }))
  return renderHookWithConsoleQuery(() => useWorkflowTemplate(), {
    queryClient,
    resource: { kind: 'app', appId: 'app-1', mode: mode === 'advanced-chat' ? mode : 'workflow' },
  })
}

describe('useWorkflowTemplate', () => {
  it('should return only the start placeholder template in workflow mode', () => {
    const { result } = renderTemplateHook('workflow')

    expect(result.current.nodes).toHaveLength(1)
    expect(result.current.edges).toEqual([])
    expect(result.current.nodes[0]!.data).toMatchObject({
      type: 'start-placeholder',
      title: 'workflow.blocks.start-placeholder',
      selected: true,
      desc: '',
    })
  })

  it('should return the start node template for non-workflow app modes', () => {
    const { result } = renderTemplateHook('completion')

    expect(result.current.nodes).toHaveLength(1)
    expect(result.current.edges).toEqual([])
    expect(result.current.nodes[0]!.data).toMatchObject({
      type: 'start',
      title: 'workflow.blocks.start',
    })
  })

  it('should build start, llm, and answer templates with linked edges in chat mode', () => {
    const { result } = renderTemplateHook('advanced-chat')

    expect(result.current.nodes).toHaveLength(3)
    expect(result.current.nodes.map((node) => node.id)).toEqual([
      expect.any(String),
      'llm',
      'answer',
    ])
    expect(result.current.edges).toEqual([
      {
        id: `${result.current.nodes[0]!.id}-llm`,
        source: result.current.nodes[0]!.id,
        sourceHandle: 'source',
        target: 'llm',
        targetHandle: 'target',
      },
      {
        id: 'llm-answer',
        source: 'llm',
        sourceHandle: 'source',
        target: 'answer',
        targetHandle: 'target',
      },
    ])
    expect(result.current.nodes[0]!.data).toMatchObject({
      type: 'start',
      title: 'workflow.blocks.start',
    })
    expect(result.current.nodes[1]!.data).toMatchObject({
      type: 'llm',
      title: 'workflow.blocks.llm',
    })
    expect(result.current.nodes[2]!.data).toMatchObject({
      type: 'answer',
      title: 'workflow.blocks.answer',
      answer: '{{#llm.text#}}',
    })
  })
})
