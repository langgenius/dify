import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { AppSourceType } from '@/service/share'
import {
  createHumanInputFormFixture,
  createWorkflowProcessFixture,
} from '@/test/fixtures/workflow-process'
import GenerationItem from '../index'

const mockFetchMoreLikeThis = vi.fn()
const mockFetchTextGenerationMessage = vi.fn()
const mockUpdateFeedback = vi.fn()
const mockSubmitHumanInputForm = vi.fn()
const mockSubmitWebAppHumanInputForm = vi.fn()
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

vi.mock('@/service/webapp-human-input', () => ({
  submitWebAppHumanInputForm: (...args: unknown[]) => mockSubmitWebAppHumanInputForm(...args),
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

vi.mock('../workflow-body', () => ({
  default: ({
    currentTab,
    onSubmitHumanInputForm,
    onSwitchTab,
  }: {
    currentTab: string
    onSubmitHumanInputForm: (
      token: string,
      data: { inputs: Record<string, string>; action: string },
    ) => Promise<void>
    onSwitchTab: (tab: string) => Promise<void>
  }) => (
    <div>
      <div>{`workflow-body:${currentTab}`}</div>
      <button
        onClick={() =>
          void onSubmitHumanInputForm('token-1', { action: 'submit', inputs: { name: 'dify' } })
        }
      >
        submit-human-input
      </button>
      <button onClick={() => void onSwitchTab('LOG')}>switch-workflow-tab</button>
    </div>
  ),
}))

describe('GenerationItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    {
      appSourceType: AppSourceType.webApp,
      formVersion: '1' as const,
      submit: mockSubmitWebAppHumanInputForm,
      unusedSubmit: mockSubmitHumanInputForm,
    },
    {
      appSourceType: AppSourceType.webApp,
      formVersion: '2' as const,
      submit: mockSubmitWebAppHumanInputForm,
      unusedSubmit: mockSubmitHumanInputForm,
    },
    {
      appSourceType: AppSourceType.webApp,
      formVersion: undefined,
      submit: mockSubmitWebAppHumanInputForm,
      unusedSubmit: mockSubmitHumanInputForm,
    },
    {
      appSourceType: AppSourceType.tryApp,
      formVersion: undefined,
      submit: mockSubmitHumanInputForm,
      unusedSubmit: mockSubmitWebAppHumanInputForm,
    },
  ])(
    'preserves $appSourceType version $formVersion submission and workflow tab switching',
    async ({ appSourceType, formVersion, submit, unusedSubmit }) => {
      const user = userEvent.setup()
      render(
        <GenerationItem
          appSourceType={appSourceType}
          content="workflow result"
          isError={false}
          isWorkflow
          messageId="msg-1"
          onRetry={vi.fn()}
          siteInfo={null}
          workflowProcessData={createWorkflowProcessFixture({
            resultText: 'workflow result',
            humanInputFormDataList: [createHumanInputFormFixture({ form_version: formVersion })],
          })}
        />,
      )

      expect(screen.getByText('workflow-body:RESULT')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'submit-human-input' }))
      await user.click(screen.getByRole('button', { name: 'switch-workflow-tab' }))

      expect(submit).toHaveBeenCalledWith(
        'token-1',
        {
          action: 'submit',
          inputs: { name: 'dify' },
        },
        ...(appSourceType === AppSourceType.webApp ? [formVersion] : []),
      )
      expect(unusedSubmit).not.toHaveBeenCalled()
      expect(mockSubmitHumanInputFormWorkflow).not.toHaveBeenCalled()
      expect(screen.getByText('workflow-body:LOG')).toBeInTheDocument()
    },
  )

  it.each([true, false])(
    'waits for approval events and submits only when ready is %s',
    async (ready) => {
      const user = userEvent.setup()
      let resolvePreparation: ((ready: boolean) => void) | undefined
      const prepareHumanInputSubmission = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolvePreparation = resolve
          }),
      )
      render(
        <GenerationItem
          appSourceType={AppSourceType.webApp}
          content=""
          isError={false}
          isWorkflow
          onRetry={vi.fn()}
          prepareHumanInputSubmission={prepareHumanInputSubmission}
          siteInfo={null}
          workflowProcessData={{ status: WorkflowRunningStatus.Paused, tracing: [], expand: false }}
        />,
      )
      await user.click(screen.getByRole('button', { name: 'submit-human-input' }))
      expect(prepareHumanInputSubmission).toHaveBeenCalledOnce()
      expect(mockSubmitWebAppHumanInputForm).not.toHaveBeenCalled()
      await act(async () => resolvePreparation?.(ready))
      if (ready) {
        expect(mockSubmitWebAppHumanInputForm).toHaveBeenCalledExactlyOnceWith(
          'token-1',
          {
            inputs: { name: 'dify' },
            action: 'submit',
          },
          undefined,
        )
      } else {
        expect(mockSubmitWebAppHumanInputForm).not.toHaveBeenCalled()
      }
      expect(mockSubmitHumanInputForm).not.toHaveBeenCalled()
      expect(mockSubmitHumanInputFormWorkflow).not.toHaveBeenCalled()
    },
  )
})
