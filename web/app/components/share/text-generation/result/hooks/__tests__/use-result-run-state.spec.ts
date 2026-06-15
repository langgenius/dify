import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import { act, renderHook, waitFor } from '@testing-library/react'
import { AppSourceType } from '@/service/share'
import { useResultRunState } from '../use-result-run-state'

const {
  stopChatMessageRespondingMock,
  stopWorkflowMessageMock,
  updateFeedbackMock,
} = vi.hoisted(() => ({
  stopChatMessageRespondingMock: vi.fn(),
  stopWorkflowMessageMock: vi.fn(),
  updateFeedbackMock: vi.fn(),
}))

vi.mock('@/service/share', async () => {
  const actual = await vi.importActual<typeof import('@/service/share')>('@/service/share')
  return {
    ...actual,
    stopChatMessageResponding: (...args: Parameters<typeof actual.stopChatMessageResponding>) => stopChatMessageRespondingMock(...args),
    stopWorkflowMessage: (...args: Parameters<typeof actual.stopWorkflowMessage>) => stopWorkflowMessageMock(...args),
    updateFeedback: (...args: Parameters<typeof actual.updateFeedback>) => updateFeedbackMock(...args),
  }
})

describe('useResultRunState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stopChatMessageRespondingMock.mockResolvedValue(undefined)
    stopWorkflowMessageMock.mockResolvedValue(undefined)
    updateFeedbackMock.mockResolvedValue(undefined)
  })

  it('should expose run control and stop completion requests', async () => {
    const notify = vi.fn()
    const onRunControlChange = vi.fn()
    const { result } = renderHook(() => useResultRunState({
      appId: 'app-1',
      appSourceType: AppSourceType.webApp,
      controlStopResponding: 0,
      isWorkflow: false,
      notify,
      onRunControlChange,
    }))

    const abort = vi.fn()

    act(() => {
      result.current.abortControllerRef.current = { abort } as unknown as AbortController
      result.current.setCurrentTaskId('task-1')
      result.current.setRespondingTrue()
    })

    await waitFor(() => {
      expect(onRunControlChange).toHaveBeenLastCalledWith(expect.objectContaining({
        isStopping: false,
      }))
    })

    await act(async () => {
      await result.current.handleStop()
    })

    expect(stopChatMessageRespondingMock).toHaveBeenCalledWith('app-1', 'task-1', AppSourceType.webApp, 'app-1')
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('should update feedback and react to external stop control', async () => {
    const notify = vi.fn()
    const onRunControlChange = vi.fn()
    const { result, rerender } = renderHook(({ controlStopResponding }) => useResultRunState({
      appId: 'app-2',
      appSourceType: AppSourceType.installedApp,
      controlStopResponding,
      isWorkflow: true,
      notify,
      onRunControlChange,
    }), {
      initialProps: { controlStopResponding: 0 },
    })

    const abort = vi.fn()
    act(() => {
      result.current.abortControllerRef.current = { abort } as unknown as AbortController
      result.current.setMessageId('message-1')
    })

    await act(async () => {
      await result.current.handleFeedback({
        rating: 'like',
      } satisfies FeedbackType)
    })

    expect(updateFeedbackMock).toHaveBeenCalledWith({
      url: '/messages/message-1/feedbacks',
      body: {
        rating: 'like',
        content: undefined,
      },
    }, AppSourceType.installedApp, 'app-2')
    expect(result.current.feedback).toEqual({
      rating: 'like',
    })

    act(() => {
      result.current.setCurrentTaskId('task-2')
      result.current.setRespondingTrue()
    })

    rerender({ controlStopResponding: 1 })

    await waitFor(() => {
      expect(abort).toHaveBeenCalled()
      expect(result.current.currentTaskId).toBeNull()
      expect(onRunControlChange).toHaveBeenLastCalledWith(null)
    })
  })

  it('should stop workflow requests through the workflow stop API', async () => {
    const notify = vi.fn()
    const { result } = renderHook(() => useResultRunState({
      appId: 'app-3',
      appSourceType: AppSourceType.installedApp,
      controlStopResponding: 0,
      isWorkflow: true,
      notify,
    }))

    act(() => {
      result.current.setCurrentTaskId('task-3')
    })

    await act(async () => {
      await result.current.handleStop()
    })

    expect(stopWorkflowMessageMock).toHaveBeenCalledWith('app-3', 'task-3', AppSourceType.installedApp, 'app-3')
  })

  it('should ignore invalid stops and report non-Error failures', async () => {
    const notify = vi.fn()
    stopChatMessageRespondingMock.mockRejectedValueOnce('stop failed')

    const { result } = renderHook(() => useResultRunState({
      appSourceType: AppSourceType.webApp,
      controlStopResponding: 0,
      isWorkflow: false,
      notify,
    }))

    await act(async () => {
      await result.current.handleStop()
    })

    expect(stopChatMessageRespondingMock).not.toHaveBeenCalled()

    act(() => {
      result.current.setCurrentTaskId('task-4')
      result.current.setIsStopping(prev => !prev)
      result.current.setIsStopping(prev => !prev)
    })

    await act(async () => {
      await result.current.handleStop()
    })

    expect(stopChatMessageRespondingMock).toHaveBeenCalledWith(undefined, 'task-4', AppSourceType.webApp, '')
    expect(notify).toHaveBeenCalledWith({
      type: 'error',
      message: 'stop failed',
    })
    expect(result.current.isStopping).toBe(false)
  })

  it('should report Error instances from workflow stop failures without an app id fallback', async () => {
    const notify = vi.fn()
    stopWorkflowMessageMock.mockRejectedValueOnce(new Error('workflow stop failed'))

    const { result } = renderHook(() => useResultRunState({
      appSourceType: AppSourceType.installedApp,
      controlStopResponding: 0,
      isWorkflow: true,
      notify,
    }))

    act(() => {
      result.current.setCurrentTaskId('task-5')
    })

    await act(async () => {
      await result.current.handleStop()
    })

    expect(stopWorkflowMessageMock).toHaveBeenCalledWith(undefined, 'task-5', AppSourceType.installedApp, '')
    expect(notify).toHaveBeenCalledWith({
      type: 'error',
      message: 'workflow stop failed',
    })
  })
})
