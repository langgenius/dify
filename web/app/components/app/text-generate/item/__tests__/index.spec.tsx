import type { ReactNode } from 'react'
import type { HumanInputFormData } from '@/types/workflow'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatContextProvider } from '@/app/components/base/chat/chat/context-provider'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType, WorkflowRunningStatus } from '@/app/components/workflow/types'
import { AppSourceType } from '@/service/share'
import {
  createHumanInputFormFixture,
  createWorkflowProcessFixture,
} from '@/test/fixtures/workflow-process'
import GenerationItem from '../index'

const mockFetchMoreLikeThis = vi.fn()
const mockFetchTextGenerationMessage = vi.fn()
const mockUpdateFeedback = vi.fn()
const mockOnOpenLog = vi.fn()
const mockSubmitHumanInputFormWorkflow = vi.fn()
const mockToastWarning = vi.fn()
vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  ENABLE_HITL_IM: true,
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
    updateFeedback: (...args: unknown[]) => mockUpdateFeedback(...args),
  }
})

vi.mock('@/service/workflow', () => ({
  submitHumanInputForm: (...args: unknown[]) => mockSubmitHumanInputFormWorkflow(...args),
}))

vi.mock('@/service/debug', () => ({
  fetchTextGenerationMessage: (...args: unknown[]) => mockFetchTextGenerationMessage(...args),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    warning: (...args: unknown[]) => mockToastWarning(...args),
    success: vi.fn(),
  },
}))

const renderItem = (ui: ReactNode) =>
  render(ui, {
    wrapper: ({ children }) => <ChatContextProvider chatList={[]}>{children}</ChatContextProvider>,
  })

const reachableForm = (overrides: Partial<HumanInputFormData> = {}) =>
  createHumanInputFormFixture({
    form_content: 'Name {{#$output.name#}}',
    inputs: [
      {
        type: InputVarType.paragraph,
        output_variable_name: 'name',
        default: { type: 'constant', value: '', selector: [] },
      },
    ],
    actions: [{ id: 'submit', title: 'Submit', button_style: UserActionButtonType.Primary }],
    ...overrides,
  })

describe('GenerationItem', () => {
  it('should render markdown content and allow more-like-this recursion', async () => {
    const user = userEvent.setup()
    mockFetchMoreLikeThis.mockResolvedValue({
      answer: 'follow up answer',
      id: 'msg-2',
    })
    mockUpdateFeedback.mockResolvedValue(undefined)

    renderItem(
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

    expect(await screen.findByText('hello world')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /(?:^|\.)feature\.moreLikeThis\.title(?=$|:)/ }),
    )

    await waitFor(() => {
      expect(screen.getByText('follow up answer')).toBeInTheDocument()
    })
    expect(mockFetchMoreLikeThis).toHaveBeenCalledWith('msg-1', AppSourceType.webApp, undefined)

    await user.click(
      screen.getAllByRole('button', { name: /(?:^|\.)operation\.agree(?=$|:)/ }).at(-1)!,
    )

    expect(mockUpdateFeedback).toHaveBeenCalledWith(
      {
        body: { rating: 'like' },
        messageId: 'msg-2',
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

    renderItem(
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
    renderItem(
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
    renderItem(
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
    expect(await screen.findByText('Child answer')).toBeInTheDocument()
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

  it.each(['1', '2', undefined] as const)(
    'submits the installed workflow form with its matching version %s',
    async (version) => {
      const user = userEvent.setup()
      renderItem(
        <GenerationItem
          appSourceType={AppSourceType.installedApp}
          content="workflow result"
          isError={false}
          isWorkflow
          messageId="msg-1"
          onRetry={vi.fn()}
          siteInfo={null}
          workflowProcessData={createWorkflowProcessFixture({
            status: WorkflowRunningStatus.Paused,
            resultText: 'workflow result',
            humanInputFormDataList: [
              reachableForm({
                form_id: 'another-form',
                node_id: 'another-node',
                form_token: 'another-token',
                form_version: version === '2' ? '1' : '2',
                display_in_ui: false,
              }),
              reachableForm({ form_version: version }),
            ],
          })}
        />,
      )

      expect(await screen.findByText('workflow result')).toBeInTheDocument()
      await user.type(screen.getByRole('textbox', { name: 'name' }), 'Dify')
      await user.click(screen.getByRole('button', { name: 'Submit' }))

      expect(mockSubmitHumanInputFormWorkflow).toHaveBeenCalledWith(
        'token-1',
        { action: 'submit', inputs: { name: 'Dify' } },
        version,
      )
    },
  )

  it('uses the current form version after workflow state updates', async () => {
    const user = userEvent.setup()
    const view = (version: HumanInputFormData['form_version']) => (
      <GenerationItem
        appSourceType={AppSourceType.installedApp}
        content=""
        isError={false}
        isWorkflow
        onRetry={vi.fn()}
        siteInfo={null}
        workflowProcessData={createWorkflowProcessFixture({
          status: WorkflowRunningStatus.Paused,
          humanInputFormDataList: [reachableForm({ form_version: version })],
        })}
      />
    )
    const { rerender } = renderItem(view('1'))
    await user.type(screen.getByRole('textbox', { name: 'name' }), 'First')
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    rerender(view('2'))
    const name = screen.getByRole('textbox', { name: 'name' })
    await user.clear(name)
    await user.type(name, 'Second')
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(mockSubmitHumanInputFormWorkflow).toHaveBeenNthCalledWith(
      1,
      'token-1',
      { action: 'submit', inputs: { name: 'First' } },
      '1',
    )
    expect(mockSubmitHumanInputFormWorkflow).toHaveBeenNthCalledWith(
      2,
      'token-1',
      { action: 'submit', inputs: { name: 'Second' } },
      '2',
    )
  })

  it('should clear recursive results when requested or when the parent reloads', async () => {
    const user = userEvent.setup()
    mockFetchMoreLikeThis.mockResolvedValue({
      answer: 'follow up answer',
      id: 'msg-2',
    })

    const { rerender } = renderItem(
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
      expect(screen.getByText('follow up answer')).toBeInTheDocument()
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

    expect(screen.queryByText('follow up answer')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /feature\.moreLikeThis\.title/ }))
    expect(await screen.findByText('follow up answer')).toBeInTheDocument()

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

    expect(screen.queryByText('follow up answer')).not.toBeInTheDocument()
  })

  it('should warn instead of requesting more-like-this without a message id', async () => {
    const user = userEvent.setup()
    renderItem(
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
