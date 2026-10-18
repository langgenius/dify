import type { ComponentProps } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { AppSourceType } from '@/service/share'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import {
  createHumanInputFormFixture,
  createWorkflowProcessFixture,
} from '@/test/fixtures/workflow-process'
import GenerationItem from '../index'

const mockFetchMoreLikeThis = vi.fn()
const mockFetchTextGenerationMessage = vi.fn()
const mockUpdateFeedback = vi.fn()
const mockOnOpenLog = vi.fn()
const mockSubmitHumanInputForm = vi.fn()
const mockSubmitHumanInputFormWorkflow = vi.fn()
const mockToastWarning = vi.fn()
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

vi.mock('@/app/notifications', () => ({
  toast: {
    warning: (...args: unknown[]) => mockToastWarning(...args),
    success: vi.fn(),
  },
}))

// Monaco is outside the tab-selection contract; WorkflowBody and ResultTab stay real.
vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({
    title,
    value,
  }: ComponentProps<
    typeof import('@/app/components/workflow/nodes/_base/components/editor/code-editor').default
  >) => (
    <section aria-label="Workflow detail">
      {title}
      <pre>{String(value)}</pre>
    </section>
  ),
}))

const approvalForm = () =>
  createHumanInputFormFixture({
    actions: [{ id: 'submit', title: 'Approve', button_style: UserActionButtonType.Primary }],
  })

describe('GenerationItem', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockSubmitHumanInputForm.mockResolvedValue(undefined)
    mockSubmitHumanInputFormWorkflow.mockResolvedValue(undefined)
  })

  it('should render markdown content and allow more-like-this recursion', async () => {
    const user = userEvent.setup()
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

    await user.click(
      screen.getByRole('button', { name: /(?:^|\.)feature\.moreLikeThis\.title(?=$|:)/ }),
    )

    await waitFor(() => {
      expect(screen.getByText('markdown:follow up answer')).toBeInTheDocument()
    })
    expect(mockFetchMoreLikeThis).toHaveBeenCalledWith('msg-1', AppSourceType.webApp, undefined)

    await user.click(
      screen.getAllByRole('button', { name: /(?:^|\.)operation\.agree(?=$|:)/ }).at(-1)!,
    )

    expect(mockUpdateFeedback).toHaveBeenCalledWith(
      {
        body: { rating: 'like' },
        url: '/messages/msg-2/feedbacks',
      },
      AppSourceType.webApp,
      undefined,
    )
  })

  it('should send normalized log data to the owning surface', async () => {
    const user = userEvent.setup()
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
        onOpenLog={mockOnOpenLog}
        siteInfo={null}
      />,
    )

    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.log(?=$|:)/ }))

    expect(mockFetchTextGenerationMessage).toHaveBeenCalledWith({
      appId: 'app-1',
      messageId: 'msg-1',
    })
    expect(mockOnOpenLog).toHaveBeenCalledWith(
      expect.objectContaining({
        log: [
          { role: 'user', text: 'hello' },
          {
            role: 'assistant',
            text: 'assistant answer',
            files: [{ belongs_to: 'assistant', id: 'file-1' }],
          },
        ],
      }),
    )
  })

  it('keeps the log action absent without an owning surface', () => {
    render(
      <GenerationItem
        appSourceType={AppSourceType.webApp}
        content="Answer"
        isError={false}
        messageId="msg-1"
        onRetry={vi.fn()}
        siteInfo={null}
      />,
    )

    expect(screen.queryByRole('button', { name: /operation\.log/ })).not.toBeInTheDocument()
    expect(mockFetchTextGenerationMessage).not.toHaveBeenCalled()
  })

  it('opens a more-like-this child log through the same owner using the child message', async () => {
    const user = userEvent.setup()
    mockFetchMoreLikeThis.mockResolvedValue({ answer: 'Child answer', id: 'child-message' })
    mockFetchTextGenerationMessage.mockResolvedValue({
      id: 'child-message',
      answer: 'Child answer',
      message: [{ role: 'user', text: 'Child prompt' }],
    })
    render(
      <GenerationItem
        appSourceType={AppSourceType.webApp}
        content="Parent answer"
        isError={false}
        messageId="parent-message"
        moreLikeThis
        onOpenLog={mockOnOpenLog}
        onRetry={vi.fn()}
        siteInfo={null}
      />,
    )

    await user.click(screen.getByRole('button', { name: /feature\.moreLikeThis\.title/ }))
    expect(await screen.findByText('markdown:Child answer')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /operation\.log/ })[1]!)

    await waitFor(() =>
      expect(mockOnOpenLog).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          id: 'child-message',
          log: [
            { role: 'user', text: 'Child prompt' },
            { role: 'assistant', text: 'Child answer', files: [] },
          ],
        }),
      ),
    )
    expect(mockFetchTextGenerationMessage).toHaveBeenCalledExactlyOnceWith({
      appId: 'app-1',
      messageId: 'child-message',
    })
  })

  it('should route human input submissions to the workflow service for installed apps', async () => {
    const user = userEvent.setup()
    render(
      <GenerationItem
        appSourceType={AppSourceType.installedApp}
        content="workflow result"
        isError={false}
        isWorkflow
        messageId="msg-1"
        onRetry={vi.fn()}
        siteInfo={null}
        workflowProcessData={createWorkflowProcessFixture({
          resultText: 'workflow result',
          humanInputFormDataList: [approvalForm()],
        })}
      />,
    )

    expect(screen.getByText('markdown:workflow result')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(mockSubmitHumanInputForm).not.toHaveBeenCalled()
    expect(mockSubmitHumanInputFormWorkflow).toHaveBeenCalledWith('token-1', {
      action: 'submit',
      inputs: {},
    })
  })

  it('should route human input submissions to the share service and allow workflow tab switching', async () => {
    const user = userEvent.setup()
    render(
      <GenerationItem
        appSourceType={AppSourceType.webApp}
        content="workflow result"
        isError={false}
        isWorkflow
        messageId="msg-1"
        onRetry={vi.fn()}
        siteInfo={null}
        workflowProcessData={createWorkflowProcessFixture({
          resultText: 'workflow result',
          humanInputFormDataList: [approvalForm()],
        })}
      />,
    )

    expect(screen.getByText('markdown:workflow result')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await user.click(screen.getByText('runLog.detail'))

    expect(mockSubmitHumanInputFormWorkflow).not.toHaveBeenCalled()
    expect(mockSubmitHumanInputForm).toHaveBeenCalledWith('token-1', {
      action: 'submit',
      inputs: {},
    })
    expect(screen.getByRole('region', { name: 'Workflow detail' })).toHaveTextContent(
      'workflow result',
    )
    expect(screen.queryByText('markdown:workflow result')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    await user.click(screen.getByText('runLog.result'))
    expect(screen.getByText('markdown:workflow result')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Workflow detail' })).not.toBeInTheDocument()
  })

  it('should clear recursive results when requested or when the parent reloads', async () => {
    const user = userEvent.setup()
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

    await user.click(
      screen.getByRole('button', { name: /(?:^|\.)feature\.moreLikeThis\.title(?=$|:)/ }),
    )

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

    await user.click(screen.getByRole('button', { name: /feature\.moreLikeThis\.title/ }))
    expect(await screen.findByText('markdown:follow up answer')).toBeInTheDocument()

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
    const user = userEvent.setup()
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

    await user.click(
      screen.getByRole('button', { name: /(?:^|\.)feature\.moreLikeThis\.title(?=$|:)/ }),
    )

    expect(mockToastWarning).toHaveBeenCalledWith(
      expect.stringMatching(/(?:^|\.)errorMessage\.waitForResponse(?=$|:)/),
    )
    expect(mockFetchMoreLikeThis).not.toHaveBeenCalled()
  })
})
