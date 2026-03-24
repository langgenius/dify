/* eslint-disable ts/no-explicit-any */
import type { ChatItemInTree } from '@/app/components/base/chat/types'
import { renderHook } from '@testing-library/react'
import { useChat } from '../../hooks'

const mockHandleRun = vi.fn()
const mockNotify = vi.fn()
const mockFetchInspectVars = vi.fn()
const mockInvalidAllLastRun = vi.fn()
const mockSetIterTimes = vi.fn()
const mockSetLoopTimes = vi.fn()
const mockSubmitHumanInputForm = vi.fn()
const mockSseGet = vi.fn()
const mockGetNodes = vi.fn((): any[] => [])

let mockWorkflowRunningData: any = null

vi.mock('@/service/base', () => ({
  sseGet: (...args: any[]) => mockSseGet(...args),
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidAllLastRun: () => mockInvalidAllLastRun,
}))

vi.mock('@/service/workflow', () => ({
  submitHumanInputForm: (...args: any[]) => mockSubmitHumanInputForm(...args),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: (...args: any[]) => mockNotify(...args),
  },
}))

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: mockGetNodes,
    }),
  }),
}))

vi.mock('../../../../hooks', () => ({
  useWorkflowRun: () => ({ handleRun: mockHandleRun }),
  useSetWorkflowVarsWithValue: () => ({ fetchInspectVars: mockFetchInspectVars }),
}))

vi.mock('../../../../hooks-store', () => ({
  useHooksStore: () => null,
}))

vi.mock('../../../../store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      setIterTimes: mockSetIterTimes,
      setLoopTimes: mockSetLoopTimes,
      inputs: {},
      workflowRunningData: mockWorkflowRunningData,
    }),
  }),
  useStore: () => vi.fn(),
}))

const resetMocksAndWorkflowState = () => {
  vi.clearAllMocks()
  mockWorkflowRunningData = null
}

describe('workflow debug useChat – opening statement stability', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
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

  it('should include suggestedQuestions in opening statement when config has them', () => {
    const config = {
      opening_statement: 'Welcome!',
      suggested_questions: ['How are you?', 'What can you do?'],
    }
    const { result } = renderHook(() => useChat(config))
    const opener = result.current.chatList[0]
    expect(opener.suggestedQuestions).toEqual(['How are you?', 'What can you do?'])
  })

  it('should not include suggestedQuestions when config has none', () => {
    const config = { opening_statement: 'Welcome!' }
    const { result } = renderHook(() => useChat(config))
    const opener = result.current.chatList[0]
    expect(opener.suggestedQuestions).toBeUndefined()
  })
})
