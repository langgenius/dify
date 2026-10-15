import {
  createConsoleQueryClient,
  renderHookWithConsoleQuery,
  seedAppDetail,
} from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppModeEnum } from '@/types/app'
import { useWorkflowTemplate } from '../use-workflow-template'

const mockUseIsChatMode = vi.fn()
let generateNewNodeCalls: Array<Record<string, unknown>> = []

const renderTemplateHook = (mode: AppModeEnum) => {
  const queryClient = createConsoleQueryClient()
  seedAppDetail(queryClient, createAppDetailFixture({ id: 'app-1', mode }))
  return renderHookWithConsoleQuery(() => useWorkflowTemplate(), { queryClient })
}

vi.mock('../use-is-chat-mode', () => ({
  useIsChatMode: () => mockUseIsChatMode(),
}))

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
}))

vi.mock('@/app/components/workflow/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/workflow/utils')>()
  return {
    ...actual,
    generateNewNode: (args: {
      id?: string
      data: Record<string, unknown>
      position: Record<string, unknown>
    }) => {
      generateNewNodeCalls.push(args)
      return {
        newNode: {
          id: args.id ?? `generated-${generateNewNodeCalls.length}`,
          data: args.data,
          position: args.position,
        },
      }
    },
  }
})

describe('useWorkflowTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateNewNodeCalls = []
  })

  it('should return only the start placeholder template in workflow mode', () => {
    mockUseIsChatMode.mockReturnValue(false)

    const { result } = renderTemplateHook(AppModeEnum.WORKFLOW)

    expect(result.current.nodes).toHaveLength(1)
    expect(result.current.edges).toEqual([])
    expect(generateNewNodeCalls).toHaveLength(1)
    expect(generateNewNodeCalls[0]!.data).toMatchObject({
      type: 'start-placeholder',
      title: 'workflow.blocks.start-placeholder',
      selected: true,
      desc: '',
    })
  })

  it('should return the start node template for non-workflow app modes', () => {
    mockUseIsChatMode.mockReturnValue(false)

    const { result } = renderTemplateHook(AppModeEnum.COMPLETION)

    expect(result.current.nodes).toHaveLength(1)
    expect(result.current.edges).toEqual([])
    expect(generateNewNodeCalls).toHaveLength(1)
    expect(generateNewNodeCalls[0]!.data).toMatchObject({
      type: 'start',
      title: 'workflow.blocks.start',
    })
  })

  it('should build start, llm, and answer templates with linked edges in chat mode', () => {
    mockUseIsChatMode.mockReturnValue(true)

    const { result } = renderTemplateHook(AppModeEnum.ADVANCED_CHAT)

    expect(result.current.nodes).toHaveLength(3)
    expect(result.current.nodes.map((node) => node.id)).toEqual(['generated-1', 'llm', 'answer'])
    expect(result.current.edges).toEqual([
      {
        id: 'generated-1-llm',
        source: 'generated-1',
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
    expect(generateNewNodeCalls).toHaveLength(3)
    expect(generateNewNodeCalls[0]!.data).toMatchObject({
      type: 'start',
      title: 'workflow.blocks.start',
    })
    expect(generateNewNodeCalls[1]!.data).toMatchObject({
      type: 'llm',
      title: 'workflow.blocks.llm',
    })
    expect(generateNewNodeCalls[2]!.data).toMatchObject({
      type: 'answer',
      title: 'workflow.blocks.answer',
      answer: '{{#llm.text#}}',
    })
  })
})
