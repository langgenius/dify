import type { useWorkflowRun } from '@/app/components/workflow/hooks/use-workflow-run'
import { act } from '@testing-library/react'
import { renderWorkflowCanvasHook as renderHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { fullWorkflowAccessControl } from '@/app/components/workflow/hooks-store/store'
import { useChat } from '../../hooks'

const handleRun = vi.fn<ReturnType<typeof useWorkflowRun>['handleRun']>()
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
const fetchInspectVars = vi.fn(async () => undefined)

const renderChat = (canRun = true) =>
  renderHook(() => useChat({}), {
    hooksStoreProps: {
      accessControl: { ...fullWorkflowAccessControl, canRun },
      fetchInspectVars,
      handleRun,
    },
    resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
  })

describe('useChat – handleSend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    handleRun.mockReset()
  })

  it('should call handleRun with processed params', () => {
    const { result } = renderChat()

    act(() => {
      result.current.handleSend({ query: 'hello', inputs: {} }, {})
    })

    expect(handleRun).toHaveBeenCalledTimes(1)
    const [bodyParams] = handleRun.mock.calls[0]!
    expect(bodyParams.query).toBe('hello')
    expect(result.current.isResponding).toBe(true)
    expect(result.current.chatList).toEqual([
      expect.objectContaining({ content: 'hello', isAnswer: false }),
      expect.objectContaining({ content: '', isAnswer: true }),
    ])
  })

  it('should return false and skip handleRun when test/run permission is missing', () => {
    const { result } = renderChat(false)

    let returned: unknown
    act(() => {
      returned = result.current.handleSend({ query: 'hello', inputs: {} }, {})
    })

    expect(returned).toBe(false)
    expect(handleRun).not.toHaveBeenCalled()
    expect(result.current.isResponding).toBe(false)
    expect(result.current.chatList).toHaveLength(0)
  })

  it('should show notification and return false when already responding', () => {
    handleRun.mockImplementation(() => {})

    const { result } = renderChat()

    act(() => {
      result.current.handleSend({ query: 'first' }, {})
    })

    act(() => {
      const returned = result.current.handleSend({ query: 'second' }, {})
      expect(returned).toBe(false)
    })

    expect(mockNotify).toHaveBeenCalledWith('appDebug.errorMessage.waitForResponse')
    expect(handleRun).toHaveBeenCalledTimes(1)
    expect(result.current.chatList).toEqual([
      expect.objectContaining({ content: 'first', isAnswer: false }),
      expect.objectContaining({ content: '', isAnswer: true }),
    ])
  })

  it('should strip url from local_file transfer method files', () => {
    const { result } = renderChat()

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

    expect(handleRun).toHaveBeenCalledTimes(1)
    const [bodyParams] = handleRun.mock.calls[0]!
    const files = bodyParams.files as { transfer_method: string; url: string }[]
    const localFile = files.find((file) => file.transfer_method === 'local_file')
    const remoteFile = files.find((file) => file.transfer_method === 'remote_url')
    expect(localFile!.url).toBe('')
    expect(remoteFile!.url).toBe('https://example.com/img.png')
  })

  it('should abort previous workflowEventsAbortController before sending', () => {
    const controller = new AbortController()
    handleRun.mockImplementation((_params, callbacks) => {
      callbacks!.getAbortController!(controller)
      callbacks!.onCompleted!(false)
    })

    const { result } = renderChat()

    act(() => {
      result.current.handleSend({ query: 'first' }, {})
    })

    handleRun.mockImplementation((_params, callbacks) => {
      callbacks!.getAbortController!(new AbortController())
    })

    act(() => {
      result.current.handleSend({ query: 'second' }, {})
    })

    expect(controller.signal.aborted).toBe(true)
  })
})
