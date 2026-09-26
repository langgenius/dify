import type { AppMode } from '@dify/contracts/api/console/apps/types.gen'
import { renderWorkflowHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { AppModeEnum } from '@/types/app'
import { useWorkflowTemplate } from '../use-workflow-template'

let generateNewNodeCalls: Array<Record<string, unknown>> = []
let appMode: AppMode
const renderHook = <Result>(callback: () => Result) =>
  renderWorkflowHook(callback, {
    initialStoreState: { appId: 'app-1' },
    appDetail: { id: 'app-1', mode: appMode },
  })

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
    appMode = AppModeEnum.WORKFLOW
  })

  it('should return only the start placeholder template in workflow mode', () => {
    const { result } = renderHook(() => useWorkflowTemplate())

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
    appMode = AppModeEnum.COMPLETION

    const { result } = renderHook(() => useWorkflowTemplate())

    expect(result.current.nodes).toHaveLength(1)
    expect(result.current.edges).toEqual([])
    expect(generateNewNodeCalls).toHaveLength(1)
    expect(generateNewNodeCalls[0]!.data).toMatchObject({
      type: 'start',
      title: 'workflow.blocks.start',
    })
  })

  it('should build start, llm, and answer templates with linked edges in chat mode', () => {
    appMode = AppModeEnum.ADVANCED_CHAT

    const { result } = renderHook(() => useWorkflowTemplate())

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
