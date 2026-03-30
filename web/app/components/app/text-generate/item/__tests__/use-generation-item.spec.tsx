import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { SiteInfo } from '@/models/share'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/app/components/base/ui/toast'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { AppSourceType } from '@/service/share'
import { TransferMethod } from '@/types/app'
import { generationItemHelpers, useGenerationItem } from '../use-generation-item'

const mockCopy = vi.fn()
const mockFetchTextGenerationMessage = vi.fn()
const mockFetchMoreLikeThis = vi.fn()
const mockSubmitHumanInputForm = vi.fn()
const mockUpdateFeedback = vi.fn()
const mockSubmitHumanInputFormService = vi.fn()
const mockSetCurrentLogItem = vi.fn()
const mockSetShowPromptLogModal = vi.fn()

vi.mock('copy-to-clipboard', () => ({
  default: (...args: unknown[]) => mockCopy(...args),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: {
    setCurrentLogItem: typeof mockSetCurrentLogItem
    setShowPromptLogModal: typeof mockSetShowPromptLogModal
  }) => unknown) => selector({
    setCurrentLogItem: mockSetCurrentLogItem,
    setShowPromptLogModal: mockSetShowPromptLogModal,
  }),
}))

vi.mock('@/app/components/base/chat/chat/context', () => ({
  useChatContext: () => ({
    config: {
      text_to_speech: {
        voice: 'alloy',
      },
    },
  }),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({
    appId: 'app-1',
  }),
}))

vi.mock('@/service/debug', () => ({
  fetchTextGenerationMessage: (...args: unknown[]) => mockFetchTextGenerationMessage(...args),
}))

vi.mock('@/service/share', async () => {
  const actual = await vi.importActual<typeof import('@/service/share')>('@/service/share')
  return {
    ...actual,
    fetchMoreLikeThis: (...args: unknown[]) => mockFetchMoreLikeThis(...args),
    submitHumanInputForm: (...args: unknown[]) => mockSubmitHumanInputForm(...args),
    updateFeedback: (...args: unknown[]) => mockUpdateFeedback(...args),
  }
})

vi.mock('@/service/workflow', async () => {
  const actual = await vi.importActual<typeof import('@/service/workflow')>('@/service/workflow')
  return {
    ...actual,
    submitHumanInputForm: (...args: unknown[]) => mockSubmitHumanInputFormService(...args),
  }
})

const createSiteInfo = (overrides: Partial<SiteInfo> = {}): SiteInfo => ({
  title: 'App site',
  show_workflow_steps: true,
  ...overrides,
})

const createWorkflowProcessData = (overrides: Partial<WorkflowProcess> = {}): WorkflowProcess => ({
  status: WorkflowRunningStatus.Succeeded,
  tracing: [],
  ...overrides,
})

const createMessageFile = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: 'file-1',
  name: 'file.txt',
  progress: 100,
  size: 1,
  supportFileType: 'document',
  transferMethod: TransferMethod.local_file,
  type: 'text/plain',
  ...overrides,
})

const createProps = (overrides: Partial<Parameters<typeof useGenerationItem>[0]> = {}): Parameters<typeof useGenerationItem>[0] => ({
  appSourceType: AppSourceType.webApp,
  content: 'Initial content',
  controlClearMoreLikeThis: 0,
  depth: 1,
  installedAppId: 'installed-1',
  isInWebApp: true,
  isLoading: false,
  isMobile: false,
  isShowTextToSpeech: true,
  isWorkflow: false,
  messageId: 'message-1',
  onRetry: vi.fn(),
  onSave: vi.fn(),
  siteInfo: createSiteInfo(),
  taskId: 'task-1',
  workflowProcessData: undefined,
  ...overrides,
})

describe('useGenerationItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchMoreLikeThis.mockResolvedValue({
      answer: 'Suggested answer',
      id: 'child-1',
    })
    mockFetchTextGenerationMessage.mockResolvedValue({
      answer: 'Assistant answer',
      id: 'message-1',
      message: 'Original prompt',
      message_files: [createMessageFile()],
    })
  })

  it('should derive the current tab and helper flags from workflow data', async () => {
    const { result, rerender } = renderHook(props => useGenerationItem(props), {
      initialProps: createProps({
        appSourceType: AppSourceType.tryApp,
        depth: 2,
        isWorkflow: true,
        workflowProcessData: createWorkflowProcessData({
          resultText: 'Workflow result',
        }),
      }),
    })

    expect(result.current.currentTab).toBe('RESULT')
    expect(result.current.isTop).toBe(false)
    expect(result.current.isTryApp).toBe(true)
    expect(result.current.taskLabel).toBe('task-1-1')
    expect(result.current.config?.text_to_speech?.voice).toBe('alloy')

    rerender(createProps({
      depth: 2,
      isWorkflow: true,
      workflowProcessData: createWorkflowProcessData(),
    }))

    await waitFor(() => {
      expect(result.current.currentTab).toBe('DETAIL')
    })
  })

  it('should request more-like-this responses and reuse the returned message for child feedback', async () => {
    const { result } = renderHook(() => useGenerationItem(createProps()))

    await act(async () => {
      await result.current.handleMoreLikeThis()
    })

    expect(mockFetchMoreLikeThis).toHaveBeenCalledWith('message-1', AppSourceType.webApp, 'installed-1')
    expect(result.current.completionRes).toBe('Suggested answer')
    expect(result.current.childMessageId).toBe('child-1')
    expect(result.current.showChildItem).toBe(true)
    expect(result.current.childProps.messageId).toBe('child-1')
    expect(result.current.childProps.feedback).toEqual({ rating: null })

    await act(async () => {
      await result.current.childProps.onFeedback?.({ rating: 'like' })
    })

    expect(mockUpdateFeedback).toHaveBeenCalledWith({
      body: { rating: 'like' },
      url: '/messages/child-1/feedbacks',
    }, AppSourceType.webApp, 'installed-1')
  })

  it('should warn instead of requesting more-like-this when no source message is available', async () => {
    const { result } = renderHook(() => useGenerationItem(createProps({ messageId: undefined })))

    await act(async () => {
      await result.current.handleMoreLikeThis()
    })

    expect(mockFetchMoreLikeThis).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith('appDebug.errorMessage.waitForResponse')
  })

  it('should clear child content when the clear control changes or the parent starts loading', async () => {
    const { result, rerender } = renderHook(props => useGenerationItem(props), {
      initialProps: createProps(),
    })

    await act(async () => {
      await result.current.handleMoreLikeThis()
    })

    expect(result.current.childMessageId).toBe('child-1')

    rerender(createProps({ controlClearMoreLikeThis: 1 }))

    await waitFor(() => {
      expect(result.current.childMessageId).toBeNull()
      expect(result.current.completionRes).toBe('')
    })

    await act(async () => {
      await result.current.handleMoreLikeThis()
    })

    rerender(createProps({ isLoading: true }))

    await waitFor(() => {
      expect(result.current.childMessageId).toBeNull()
    })
  })

  it('should normalize log entries and open the prompt log modal', async () => {
    const { result } = renderHook(() => useGenerationItem(createProps()))

    await act(async () => {
      await result.current.handleOpenLogModal()
    })

    expect(mockFetchTextGenerationMessage).toHaveBeenCalledWith({
      appId: 'app-1',
      messageId: 'message-1',
    })
    expect(mockSetShowPromptLogModal).toHaveBeenCalledWith(true)
    expect(mockSetCurrentLogItem).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Assistant answer',
      id: 'message-1',
      isAnswer: true,
      log: [{
        role: 'user',
        text: 'Original prompt',
      }],
    }))
  })

  it('should route human input submissions to share and workflow services based on app source', async () => {
    const shareHook = renderHook(() => useGenerationItem(createProps()))

    await act(async () => {
      await shareHook.result.current.handleSubmitHumanInputForm('token-1', {
        action: 'submit',
        inputs: { city: 'Paris' },
      })
    })

    expect(mockSubmitHumanInputForm).toHaveBeenCalledWith('token-1', {
      action: 'submit',
      inputs: { city: 'Paris' },
    })

    const installedHook = renderHook(() => useGenerationItem(createProps({
      appSourceType: AppSourceType.installedApp,
    })))

    await act(async () => {
      await installedHook.result.current.handleSubmitHumanInputForm('token-2', {
        action: 'confirm',
        inputs: { city: 'Berlin' },
      })
    })

    expect(mockSubmitHumanInputFormService).toHaveBeenCalledWith('token-2', {
      action: 'confirm',
      inputs: { city: 'Berlin' },
    })
  })

  it('should copy workflow text directly and stringify non-string content', async () => {
    const { result: workflowResult } = renderHook(() => useGenerationItem(createProps({
      content: { raw: true },
      isWorkflow: true,
      workflowProcessData: createWorkflowProcessData({
        resultText: 'Workflow text',
      }),
    })))

    await act(async () => {
      workflowResult.current.handleCopy()
    })

    expect(mockCopy).toHaveBeenCalledWith('Workflow text')
    expect(toast.success).toHaveBeenCalledWith('common.actionMsg.copySuccessfully')

    const { result: jsonResult } = renderHook(() => useGenerationItem(createProps({
      content: { raw: true },
    })))

    await act(async () => {
      jsonResult.current.handleCopy()
    })

    expect(mockCopy).toHaveBeenCalledWith(JSON.stringify({ raw: true }))
  })
})

describe('generationItemHelpers', () => {
  it('should build a normalized log item from text messages', () => {
    const logItem = generationItemHelpers.buildLogItem({
      answer: 'Assistant answer',
      data: {
        answer: 'Assistant answer',
        id: 'message-1',
        message: 'Original prompt',
        message_files: [createMessageFile()],
      },
      messageId: 'message-1',
    }) as IChatItem

    expect(logItem.id).toBe('message-1')
    expect(logItem.log).toEqual([{ role: 'user', text: 'Original prompt' }])
  })

  it('should compute the default tab from workflow result availability', () => {
    expect(generationItemHelpers.getCurrentTab(createWorkflowProcessData({ resultText: 'done' }))).toBe('RESULT')
    expect(generationItemHelpers.getCurrentTab(createWorkflowProcessData({
      files: [{ id: 'file-1' }] as unknown as WorkflowProcess['files'],
    }))).toBe('RESULT')
    expect(generationItemHelpers.getCurrentTab(createWorkflowProcessData())).toBe('DETAIL')
  })
})
