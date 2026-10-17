import type { useWorkflowRun } from '@/app/components/workflow/hooks/use-workflow-run'
import type { VisionFile } from '@/types/app'
import { act } from '@testing-library/react'
import { renderEditorHook as renderHook } from '@/app/components/workflow/editor-resource/__tests__/render'
import { useChat } from '../../hooks'

type WorkflowRunCallbacks = NonNullable<
  Parameters<ReturnType<typeof useWorkflowRun>['handleRun']>[1]
>

type WorkflowRunParams = Omit<Parameters<ReturnType<typeof useChat>['handleSend']>[0], 'files'> & {
  files?: VisionFile[]
}

const mockHandleRun = vi.fn<(params: WorkflowRunParams, callbacks: WorkflowRunCallbacks) => void>()
const mockNotify = vi.fn()
const mockFetchInspectVars = vi.fn()
const mockInvalidAllLastRun = vi.fn()
const mockSetIterTimes = vi.fn()
const mockSetLoopTimes = vi.fn()
const mockSubmitHumanInputForm = vi.fn()
const mockSseGet = vi.fn()
const mockGetNodes = vi.fn((): { id: string; type: string; data: Record<string, unknown> }[] => [])
const mockHooksStoreState = vi.hoisted(() => ({
  canRun: true,
}))

let mockWorkflowRunningData: { result: { status: string } } | null = null

vi.mock('@/service/base', () => ({
  sseGet: (...args: unknown[]) => mockSseGet(...args),
}))

vi.mock('@/service/use-workflow', () => ({
  useInvalidateAllLastRun: () => mockInvalidAllLastRun,
}))

vi.mock('@/service/workflow', () => ({
  submitHumanInputForm: (...args: unknown[]) => mockSubmitHumanInputForm(...args),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: (...args: unknown[]) => mockNotify(...args),
  },
}))

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: mockGetNodes,
    }),
  }),
}))

vi.mock('../../../../hooks/use-workflow-run', () => ({
  useWorkflowRun: () => ({ handleRun: mockHandleRun }),
}))

vi.mock('../../../../hooks/use-set-workflow-vars-with-value', () => ({
  useSetWorkflowVarsWithValue: () => ({ fetchInspectVars: mockFetchInspectVars }),
}))

vi.mock('../../../../hooks-store', () => ({
  useHooksStore: (
    selector: (state: { configsMap: null; accessControl: { canRun: boolean } }) => unknown,
  ) =>
    selector({
      configsMap: null,
      accessControl: {
        canRun: mockHooksStoreState.canRun,
      },
    }),
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
  mockHooksStoreState.canRun = true
}

describe('useChat – handleSend', () => {
  beforeEach(() => {
    resetMocksAndWorkflowState()
    mockHandleRun.mockReset()
  })

  it('should call handleRun with processed params', () => {
    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    act(() => {
      result.current.handleSend({ query: 'hello', inputs: {} }, {})
    })

    expect(mockHandleRun).toHaveBeenCalledTimes(1)
    const [bodyParams] = mockHandleRun.mock.calls[0]!
    expect(bodyParams.query).toBe('hello')
  })

  it('should return false and skip handleRun when test/run permission is missing', () => {
    mockHooksStoreState.canRun = false
    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    let returned: unknown
    act(() => {
      returned = result.current.handleSend({ query: 'hello', inputs: {} }, {})
    })

    expect(returned).toBe(false)
    expect(mockHandleRun).not.toHaveBeenCalled()
    expect(result.current.chatList).toHaveLength(0)
  })

  it('should show notification and return false when already responding', () => {
    mockHandleRun.mockImplementation(() => {})

    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

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
    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })
    act(() => {
      result.current.handleSend({ query: 'hello' }, {})
    })
    expect(result.current.isResponding).toBe(true)
  })

  it('should add placeholder question and answer to chatList', () => {
    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    act(() => {
      result.current.handleSend({ query: 'test question' }, {})
    })

    const questionItem = result.current.chatList.find((item) => item.content === 'test question')
    expect(questionItem).toBeDefined()
    expect(questionItem!.isAnswer).toBe(false)

    const answerPlaceholder = result.current.chatList.find(
      (item) => item.isAnswer && !item.isOpeningStatement && item.content === '',
    )
    expect(answerPlaceholder).toBeDefined()
  })

  it('should strip url from local_file transfer method files', () => {
    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

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
          ],
        },
        {},
      )
    })

    expect(mockHandleRun).toHaveBeenCalledTimes(1)
    const [bodyParams] = mockHandleRun.mock.calls[0]!
    const localFile = bodyParams.files!.find((f) => f.transfer_method === 'local_file')
    const remoteFile = bodyParams.files!.find((f) => f.transfer_method === 'remote_url')
    expect(localFile!.url).toBe('')
    expect(remoteFile!.url).toBe('https://example.com/img.png')
  })

  it('should abort previous workflowEventsAbortController before sending', () => {
    const controller = new AbortController()
    const mockAbort = vi.spyOn(controller, 'abort')
    mockHandleRun.mockImplementation((_params: unknown, callbacks: WorkflowRunCallbacks) => {
      callbacks.getAbortController!(controller)
      callbacks.onCompleted!(false)
    })

    const { result } = renderHook(() => useChat({}), {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    act(() => {
      result.current.handleSend({ query: 'first' }, {})
    })

    mockHandleRun.mockImplementation((_params: unknown, callbacks: WorkflowRunCallbacks) => {
      callbacks.getAbortController!(new AbortController())
    })

    act(() => {
      result.current.handleSend({ query: 'second' }, {})
    })

    expect(mockAbort).toHaveBeenCalledTimes(1)
  })
})
