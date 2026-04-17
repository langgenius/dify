/* eslint-disable ts/no-explicit-any */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AppSourceType } from '@/service/share'
import GenerationItem from '../index'

const mockFetchMoreLikeThis = vi.fn()
const mockFetchTextGenerationMessage = vi.fn()
const mockUpdateFeedback = vi.fn()
const mockSetCurrentLogItem = vi.fn()
const mockSetShowPromptLogModal = vi.fn()
const mockSubmitHumanInputForm = vi.fn()
const mockSubmitHumanInputFormWorkflow = vi.fn()
const mockToastWarning = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({
    appId: 'app-1',
  }),
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

vi.mock('@/service/workflow', () => ({
  submitHumanInputForm: (...args: unknown[]) => mockSubmitHumanInputFormWorkflow(...args),
}))

vi.mock('@/service/debug', () => ({
  fetchTextGenerationMessage: (...args: unknown[]) => mockFetchTextGenerationMessage(...args),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
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

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div>{`markdown:${content}`}</div>,
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    warning: (...args: unknown[]) => mockToastWarning(...args),
    success: vi.fn(),
  },
}))

vi.mock('../workflow-body', () => ({
  default: ({
    currentTab,
    onSubmitHumanInputForm,
    onSwitchTab,
  }: {
    currentTab: string
    onSubmitHumanInputForm: (token: string, data: { inputs: Record<string, string>, action: string }) => Promise<void>
    onSwitchTab: (tab: string) => Promise<void>
  }) => (
    <div>
      <div>{`workflow-body:${currentTab}`}</div>
      <button onClick={() => void onSubmitHumanInputForm('token-1', { action: 'submit', inputs: { name: 'dify' } })}>submit-human-input</button>
      <button onClick={() => void onSwitchTab('LOG')}>switch-workflow-tab</button>
    </div>
  ),
}))

describe('GenerationItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render markdown content and allow more-like-this recursion', async () => {
    mockFetchMoreLikeThis.mockResolvedValue({
      answer: 'follow up answer',
      id: 'msg-2',
    })
    mockUpdateFeedback.mockResolvedValue(undefined)

    render(
      <GenerationItem
        appSourceType={AppSourceType.webApp}
        content="hello world"
        isError={false}
        isInWebApp
        isShowTextToSpeech={false}
        messageId="msg-1"
        moreLikeThis
        onRetry={vi.fn()}
        siteInfo={null}
        supportFeedback
      />,
    )

    expect(screen.getByText('markdown:hello world')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'feature.moreLikeThis.title' }))
    })

    await waitFor(() => {
      expect(screen.getByText('markdown:follow up answer')).toBeInTheDocument()
    })
    expect(mockFetchMoreLikeThis).toHaveBeenCalledWith('msg-1', AppSourceType.webApp, undefined)

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'operation.agree' }).at(-1)!)
    })

    expect(mockUpdateFeedback).toHaveBeenCalledWith({
      body: { rating: 'like' },
      url: '/messages/msg-2/feedbacks',
    }, AppSourceType.webApp, undefined)
  })

  it('should open the prompt log modal with normalized log data', async () => {
    mockFetchTextGenerationMessage.mockResolvedValue({
      answer: 'assistant answer',
      message: [{ role: 'user', text: 'hello' }],
      message_files: [{ belongs_to: 'assistant', id: 'file-1' }],
    })

    render(
      <GenerationItem
        appSourceType={AppSourceType.webApp}
        content="hello world"
        isError={false}
        messageId="msg-1"
        onRetry={vi.fn()}
        siteInfo={null}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'operation.log' }))
    })

    expect(mockFetchTextGenerationMessage).toHaveBeenCalledWith({
      appId: 'app-1',
      messageId: 'msg-1',
    })
    expect(mockSetCurrentLogItem).toHaveBeenCalledWith(expect.objectContaining({
      log: [
        { role: 'user', text: 'hello' },
        {
          role: 'assistant',
          text: 'assistant answer',
          files: [{ belongs_to: 'assistant', id: 'file-1' }],
        },
      ],
    }))
    expect(mockSetShowPromptLogModal).toHaveBeenCalledWith(true)
  })

  it('should route human input submissions to the workflow service for installed apps', async () => {
    render(
      <GenerationItem
        appSourceType={AppSourceType.installedApp}
        content="workflow result"
        isError={false}
        isWorkflow
        messageId="msg-1"
        onRetry={vi.fn()}
        siteInfo={null}
        workflowProcessData={{
          resultText: 'workflow result',
        } as any}
      />,
    )

    expect(screen.getByText('workflow-body:RESULT')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByText('submit-human-input'))
    })

    expect(mockSubmitHumanInputFormWorkflow).toHaveBeenCalledWith('token-1', {
      action: 'submit',
      inputs: { name: 'dify' },
    })
  })

  it('should route human input submissions to the share service and allow workflow tab switching', async () => {
    render(
      <GenerationItem
        appSourceType={AppSourceType.webApp}
        content="workflow result"
        isError={false}
        isWorkflow
        messageId="msg-1"
        onRetry={vi.fn()}
        siteInfo={null}
        workflowProcessData={{
          resultText: 'workflow result',
        } as any}
      />,
    )

    expect(screen.getByText('workflow-body:RESULT')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByText('submit-human-input'))
      fireEvent.click(screen.getByText('switch-workflow-tab'))
    })

    expect(mockSubmitHumanInputForm).toHaveBeenCalledWith('token-1', {
      action: 'submit',
      inputs: { name: 'dify' },
    })
    expect(screen.getByText('workflow-body:LOG')).toBeInTheDocument()
  })

  it('should clear recursive results when requested or when the parent reloads', async () => {
    mockFetchMoreLikeThis.mockResolvedValue({
      answer: 'follow up answer',
      id: 'msg-2',
    })

    const { rerender } = render(
      <GenerationItem
        appSourceType={AppSourceType.webApp}
        content="hello world"
        isError={false}
        isInWebApp
        isShowTextToSpeech={false}
        messageId="msg-1"
        moreLikeThis
        onRetry={vi.fn()}
        siteInfo={null}
        supportFeedback
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'feature.moreLikeThis.title' }))
    })

    await waitFor(() => {
      expect(screen.getByText('markdown:follow up answer')).toBeInTheDocument()
    })

    rerender(
      <GenerationItem
        appSourceType={AppSourceType.webApp}
        content="hello world"
        controlClearMoreLikeThis={1}
        isError={false}
        isInWebApp
        isShowTextToSpeech={false}
        messageId="msg-1"
        moreLikeThis
        onRetry={vi.fn()}
        siteInfo={null}
        supportFeedback
      />,
    )

    expect(screen.queryByText('markdown:follow up answer')).not.toBeInTheDocument()

    rerender(
      <GenerationItem
        appSourceType={AppSourceType.webApp}
        content="hello world"
        isError={false}
        isInWebApp
        isLoading
        isShowTextToSpeech={false}
        messageId="msg-1"
        moreLikeThis
        onRetry={vi.fn()}
        siteInfo={null}
        supportFeedback
      />,
    )

    expect(screen.queryByText('markdown:follow up answer')).not.toBeInTheDocument()
  })

  it('should warn instead of requesting more-like-this without a message id', async () => {
    render(
      <GenerationItem
        appSourceType={AppSourceType.webApp}
        content="hello world"
        isError={false}
        isInWebApp
        moreLikeThis
        onRetry={vi.fn()}
        siteInfo={null}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'feature.moreLikeThis.title' }))
    })

    expect(mockToastWarning).toHaveBeenCalledWith('errorMessage.waitForResponse')
    expect(mockFetchMoreLikeThis).not.toHaveBeenCalled()
  })
})
