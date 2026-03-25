/* eslint-disable ts/no-explicit-any */
import { act, renderHook } from '@testing-library/react'
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

describe('useChat – handleSend', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
    mockHandleRun.mockReset()
  })

  it('should call handleRun with processed params', () => {
    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend({ query: 'hello', inputs: {} }, {})
    })

    expect(mockHandleRun).toHaveBeenCalledTimes(1)
    const [bodyParams] = mockHandleRun.mock.calls[0]
    expect(bodyParams.query).toBe('hello')
  })

  it('should show notification and return false when already responding', () => {
    mockHandleRun.mockImplementation(() => {})

    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend({ query: 'first' }, {})
    })

    act(() => {
      const returned = result.current.handleSend({ query: 'second' }, {})
      expect(returned).toBe(false)
    })

    expect(mockNotify).toHaveBeenCalledWith('appDebug.errorMessage.waitForResponse')
  })

  it('should set isResponding to true after sending', () => {
    const { result } = renderHook(() => useChat({}))
    act(() => {
      result.current.handleSend({ query: 'hello' }, {})
    })
    expect(result.current.isResponding).toBe(true)
  })

  it('should add placeholder question and answer to chatList', () => {
    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend({ query: 'test question' }, {})
    })

    const questionItem = result.current.chatList.find(item => item.content === 'test question')
    expect(questionItem).toBeDefined()
    expect(questionItem!.isAnswer).toBe(false)

    const answerPlaceholder = result.current.chatList.find(
      item => item.isAnswer && !item.isOpeningStatement && item.content === '',
    )
    expect(answerPlaceholder).toBeDefined()
  })

  it('should strip url from local_file transfer method files', () => {
    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend(
        {
          query: 'hello',
          files: [
            {
              id: 'f1',
              name: 'test.png',
              size: 1024,
              type: 'image/png',
              progress: 100,
              transferMethod: 'local_file',
              supportFileType: 'image',
              url: 'blob://local',
              uploadedId: 'up1',
            },
            {
              id: 'f2',
              name: 'remote.png',
              size: 2048,
              type: 'image/png',
              progress: 100,
              transferMethod: 'remote_url',
              supportFileType: 'image',
              url: 'https://example.com/img.png',
              uploadedId: '',
            },
          ] as any,
        },
        {},
      )
    })

    expect(mockHandleRun).toHaveBeenCalledTimes(1)
    const [bodyParams] = mockHandleRun.mock.calls[0]
    const localFile = bodyParams.files.find((f: any) => f.transfer_method === 'local_file')
    const remoteFile = bodyParams.files.find((f: any) => f.transfer_method === 'remote_url')
    expect(localFile.url).toBe('')
    expect(remoteFile.url).toBe('https://example.com/img.png')
  })

  it('should abort previous workflowEventsAbortController before sending', () => {
    const mockAbort = vi.fn()
    mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
      callbacks.getAbortController({ abort: mockAbort } as any)
      callbacks.onCompleted(false)
    })

    const { result } = renderHook(() => useChat({}))

    act(() => {
      result.current.handleSend({ query: 'first' }, {})
    })

    mockHandleRun.mockImplementation((_params: any, callbacks: any) => {
      callbacks.getAbortController({ abort: vi.fn() } as any)
    })

    act(() => {
      result.current.handleSend({ query: 'second' }, {})
    })

    expect(mockAbort).toHaveBeenCalledTimes(1)
  })
})
