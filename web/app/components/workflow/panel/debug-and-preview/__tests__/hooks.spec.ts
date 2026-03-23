import type { ChatItemInTree } from '@/app/components/base/chat/types'
import { renderHook } from '@testing-library/react'
import { useChat } from '../hooks'

vi.mock('@/service/base', () => ({
  sseGet: vi.fn(),
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidAllLastRun: () => vi.fn(),
}))

vi.mock('@/service/workflow', () => ({
  submitHumanInputForm: vi.fn(),
}))

vi.mock('@/app/components/base/toast/context', () => ({
  useToastContext: () => ({ notify: vi.fn() }),
}))

vi.mock('reactflow', () => ({
  useStoreApi: () => ({ getState: () => ({}) }),
}))

vi.mock('../../../hooks', () => ({
  useWorkflowRun: () => ({ handleRun: vi.fn() }),
  useSetWorkflowVarsWithValue: () => ({ fetchInspectVars: vi.fn() }),
}))

vi.mock('../../../hooks-store', () => ({
  useHooksStore: () => null,
}))

vi.mock('../../../store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      setIterTimes: vi.fn(),
      setLoopTimes: vi.fn(),
      inputs: {},
    }),
  }),
  useStore: () => vi.fn(),
}))

describe('workflow debug useChat – opening statement stability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return empty chatList when config has no opening_statement', () => {
    const { result } = renderHook(() => useChat({}))
    expect(result.current.chatList).toEqual([])
  })

  it('should return empty chatList when opening_statement is an empty string', () => {
    const { result } = renderHook(() => useChat({ opening_statement: '' }))
    expect(result.current.chatList).toEqual([])
  })

  it('should use stable id "opening-statement" instead of Date.now()', () => {
    const config = { opening_statement: 'Welcome!' }

    const { result } = renderHook(() => useChat(config))
    expect(result.current.chatList[0].id).toBe('opening-statement')
  })

  it('should preserve reference when inputs change but produce identical content', () => {
    const config = {
      opening_statement: 'Hello {{name}}',
      suggested_questions: ['Ask {{name}}'],
    }
    const formSettings = { inputs: { name: 'Alice' }, inputsForm: [] }

    const { result, rerender } = renderHook(
      ({ fs }) => useChat(config, fs),
      { initialProps: { fs: formSettings } },
    )

    const openerBefore = result.current.chatList[0]
    expect(openerBefore.content).toBe('Hello Alice')

    rerender({ fs: { inputs: { name: 'Alice' }, inputsForm: [] } })

    const openerAfter = result.current.chatList[0]
    expect(openerAfter).toBe(openerBefore)
  })

  it('should create new object when content actually changes', () => {
    const config = {
      opening_statement: 'Hello {{name}}',
      suggested_questions: [],
    }

    const { result, rerender } = renderHook(
      ({ fs }) => useChat(config, fs),
      { initialProps: { fs: { inputs: { name: 'Alice' }, inputsForm: [] } } },
    )

    const openerBefore = result.current.chatList[0]
    expect(openerBefore.content).toBe('Hello Alice')

    rerender({ fs: { inputs: { name: 'Bob' }, inputsForm: [] } })

    const openerAfter = result.current.chatList[0]
    expect(openerAfter.content).toBe('Hello Bob')
    expect(openerAfter).not.toBe(openerBefore)
  })

  it('should preserve reference for existing opening statement in prevChatTree', () => {
    const config = {
      opening_statement: 'Updated welcome',
      suggested_questions: ['S1'],
    }
    const prevChatTree = [{
      id: 'opening-statement',
      content: 'old',
      isAnswer: true,
      isOpeningStatement: true,
      suggestedQuestions: [],
    }]

    const { result, rerender } = renderHook(
      ({ cfg }) => useChat(cfg, undefined, prevChatTree as ChatItemInTree[]),
      { initialProps: { cfg: config } },
    )

    const openerBefore = result.current.chatList[0]
    expect(openerBefore.content).toBe('Updated welcome')

    rerender({ cfg: config })

    const openerAfter = result.current.chatList[0]
    expect(openerAfter).toBe(openerBefore)
  })
})
