import type { useWorkflowRun } from '@/app/components/workflow/hooks/use-workflow-run'
import type { VisionFile } from '@/types/app'
import { act } from '@testing-library/react'
import { renderWorkflowFlowHook as renderHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { fullWorkflowAccessControl } from '@/app/components/workflow/hooks-store/store'
import { useChat } from '../../hooks'

type WorkflowRunCallbacks = NonNullable<
  Parameters<ReturnType<typeof useWorkflowRun>['handleRun']>[1]
>

type WorkflowRunParams = Omit<Parameters<ReturnType<typeof useChat>['handleSend']>[0], 'files'> & {
  files?: VisionFile[]
}

const mockHandleRun = vi.fn<(params: WorkflowRunParams, callbacks: WorkflowRunCallbacks) => void>()
const mockNotify = vi.fn()
vi.mock('@/app/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/notifications')>()
  return {
    ...actual,
    toast: { ...actual.toast, info: (...args: unknown[]) => mockNotify(...args) },
  }
})
const mockInvalidAllLastRun = vi.fn()
vi.mock('@/service/use-workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-workflow')>()),
  useInvalidateAllLastRun: () => mockInvalidAllLastRun,
}))
const mockFetchInspectVars = vi.fn()

vi.mock('../../../../hooks/use-workflow-run', () => ({
  useWorkflowRun: () => ({ handleRun: mockHandleRun }),
}))

vi.mock('../../../../hooks/use-set-workflow-vars-with-value', () => ({
  useSetWorkflowVarsWithValue: () => ({ fetchInspectVars: mockFetchInspectVars }),
}))

describe('useChat – handleSend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    expect(result.current.isResponding).toBe(true)
    expect(result.current.chatList).toEqual([
      expect.objectContaining({ content: 'hello', isAnswer: false }),
      expect.objectContaining({ content: '', isAnswer: true }),
    ])
  })

  it('should return false and skip handleRun when test/run permission is missing', () => {
    const { result } = renderHook(() => useChat({}), {
      hooksStoreProps: { accessControl: { ...fullWorkflowAccessControl, canRun: false } },
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

    expect(controller.signal.aborted).toBe(true)
  })
})
