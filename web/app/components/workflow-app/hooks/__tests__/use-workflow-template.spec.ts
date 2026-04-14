import { renderHook } from '@testing-library/react'
import { useWorkflowTemplate } from '../use-workflow-template'

const mockUseIsChatMode = vi.fn()
let generateNewNodeCalls: Array<Record<string, unknown>> = []

vi.mock('@/app/components/workflow-app/hooks/use-is-chat-mode', () => ({
  useIsChatMode: () => mockUseIsChatMode(),
}))

vi.mock('@/app/components/workflow/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/workflow/utils')>()
  return {
    ...actual,
    generateNewNode: (args: { id?: string, data: Record<string, unknown>, position: Record<string, unknown> }) => {
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

  it('should return only the start node template in workflow mode', () => {
    mockUseIsChatMode.mockReturnValue(false)

    const { result } = renderHook(() => useWorkflowTemplate())

    expect(result.current.nodes).toHaveLength(1)
    expect(result.current.edges).toEqual([])
    expect(generateNewNodeCalls).toHaveLength(1)
  })

  it('should build start, llm, and answer templates with linked edges in chat mode', () => {
    mockUseIsChatMode.mockReturnValue(true)

    const { result } = renderHook(() => useWorkflowTemplate())

    expect(result.current.nodes).toHaveLength(3)
    expect(result.current.nodes.map(node => node.id)).toEqual(['generated-1', 'llm', 'answer'])
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
    expect(generateNewNodeCalls[0].data).toMatchObject({
      type: 'start',
      title: 'workflow.blocks.start',
    })
    expect(generateNewNodeCalls[1].data).toMatchObject({
      type: 'llm',
      title: 'workflow.blocks.llm',
    })
    expect(generateNewNodeCalls[2].data).toMatchObject({
      type: 'answer',
      title: 'workflow.blocks.answer',
      answer: '{{#llm.text#}}',
    })
  })
})
