import type { AppMode } from '@dify/contracts/api/console/apps/types.gen'
import { useHydrateAtoms } from 'jotai/utils'
import { renderEditorHook as renderHookWithConsoleQuery } from '@/app/components/workflow/editor-resource/__tests__/render'
import { createConsoleQueryClient, seedAppDetail } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { difyBuilderPendingCreationAtom } from '../../components/dify-builder/creation'
import { useWorkflowDraftGraphForCanvas } from '../use-workflow-draft-graph-for-canvas'
import { useWorkflowTemplate } from '../use-workflow-template'

const renderTemplateHook = (mode: AppMode, pendingCreationAppId?: string) => {
  const queryClient = createConsoleQueryClient()
  seedAppDetail(queryClient, createAppDetailFixture({ id: 'app-1', mode }))
  return renderHookWithConsoleQuery(
    () => {
      useHydrateAtoms([
        [
          difyBuilderPendingCreationAtom,
          pendingCreationAppId ? { appId: pendingCreationAppId, prompt: 'Build a workflow' } : null,
        ],
      ])
      const template = useWorkflowTemplate()
      const { getWorkflowDraftGraphForCanvas } = useWorkflowDraftGraphForCanvas(mode)
      return {
        ...template,
        initialGraph: getWorkflowDraftGraphForCanvas(
          { nodes: [], edges: [] },
          { localStartPlaceholderNodes: template.nodes },
        ),
      }
    },
    {
      queryClient,
      resource: { kind: 'app', appId: 'app-1', mode: mode === 'advanced-chat' ? mode : 'workflow' },
    },
  )
}

describe('useWorkflowTemplate', () => {
  it.each([
    { entry: 'regular creation', pendingCreationAppId: undefined, selected: true },
    { entry: 'Builder creation', pendingCreationAppId: 'app-1', selected: false },
    {
      entry: 'another app with a pending Builder creation',
      pendingCreationAppId: 'app-2',
      selected: true,
    },
  ])(
    'selects the initial start placeholder appropriately for $entry',
    ({ pendingCreationAppId, selected }) => {
      const { result } = renderTemplateHook('workflow', pendingCreationAppId)

      expect(result.current.nodes).toHaveLength(1)
      expect(result.current.edges).toEqual([])
      expect(result.current.nodes[0]!.data).toMatchObject({
        type: 'start-placeholder',
        title: 'workflow.blocks.start-placeholder',
        selected,
        desc: '',
      })
      expect(result.current.initialGraph.nodes[0]!.data.selected).toBe(selected)
    },
  )

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
