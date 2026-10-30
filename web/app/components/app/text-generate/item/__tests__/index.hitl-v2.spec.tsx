import type { ReactElement } from 'react'
import { act, render, screen } from '@testing-library/react'
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

const mocks = vi.hoisted(() => ({
  submitShare: vi.fn(),
  submitWebApp: vi.fn(),
  submitWorkflow: vi.fn(),
}))

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  ENABLE_HITL_IM: true,
}))
vi.mock('@/next/navigation', () => ({ useParams: () => ({ appId: 'app-1' }) }))
vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  fetchMoreLikeThis: vi.fn(),
  submitHumanInputForm: mocks.submitShare,
  updateFeedback: vi.fn(),
}))
vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  submitHumanInputForm: mocks.submitWorkflow,
}))
vi.mock('@/service/webapp-human-input', () => ({
  submitWebAppHumanInputForm: mocks.submitWebApp,
}))
const renderItem = (ui: ReactElement) =>
  render(<ChatContextProvider chatList={[]}>{ui}</ChatContextProvider>)

const reachableForm = (formVersion?: '1' | '2') =>
  createHumanInputFormFixture({
    form_content: 'Name {{#$output.name#}}',
    form_version: formVersion,
    inputs: [
      {
        type: InputVarType.paragraph,
        output_variable_name: 'name',
        default: { type: 'constant', value: '', selector: [] },
      },
    ],
    actions: [{ id: 'submit', title: 'Submit', button_style: UserActionButtonType.Primary }],
  })

describe('GenerationItem HITL routing', () => {
  it.each([
    { appSourceType: AppSourceType.webApp, formVersion: '1' as const },
    { appSourceType: AppSourceType.webApp, formVersion: '2' as const },
    { appSourceType: AppSourceType.webApp, formVersion: undefined },
    { appSourceType: AppSourceType.tryApp, formVersion: undefined },
  ])(
    'submits a real $appSourceType form with version $formVersion and switches tabs',
    async ({ appSourceType, formVersion }) => {
      const user = userEvent.setup()
      renderItem(
        <GenerationItem
          appSourceType={appSourceType}
          content={{ detail: 'workflow detail' }}
          isError={false}
          isWorkflow
          messageId="msg-1"
          onRetry={vi.fn()}
          siteInfo={null}
          workflowProcessData={createWorkflowProcessFixture({
            status: WorkflowRunningStatus.Paused,
            resultText: 'workflow result',
            humanInputFormDataList: [reachableForm(formVersion)],
          })}
        />,
      )

      expect(screen.getByText('runLog.result')).toBeInTheDocument()
      await user.type(screen.getByRole('textbox', { name: 'name' }), 'Dify')
      await user.click(screen.getByRole('button', { name: 'Submit' }))
      await user.click(screen.getByText('runLog.detail'))

      const expectedSubmit =
        appSourceType === AppSourceType.webApp ? mocks.submitWebApp : mocks.submitShare
      expect(expectedSubmit).toHaveBeenCalledWith(
        'token-1',
        { action: 'submit', inputs: { name: 'Dify' } },
        ...(appSourceType === AppSourceType.webApp ? [formVersion] : []),
      )
      expect(mocks.submitWorkflow).not.toHaveBeenCalled()
      expect(screen.getByText('JSON OUTPUT')).toBeInTheDocument()
    },
  )

  it.each([true, false])(
    'waits for preparation before submitting when ready is %s',
    async (ready) => {
      const user = userEvent.setup()
      let resolvePreparation: ((ready: boolean) => void) | undefined
      const prepareHumanInputSubmission = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolvePreparation = resolve
          }),
      )
      renderItem(
        <GenerationItem
          appSourceType={AppSourceType.webApp}
          content=""
          isError={false}
          isWorkflow
          onRetry={vi.fn()}
          prepareHumanInputSubmission={prepareHumanInputSubmission}
          siteInfo={null}
          workflowProcessData={createWorkflowProcessFixture({
            status: WorkflowRunningStatus.Paused,
            humanInputFormDataList: [reachableForm()],
          })}
        />,
      )

      await user.type(screen.getByRole('textbox', { name: 'name' }), 'Dify')
      await user.click(screen.getByRole('button', { name: 'Submit' }))
      expect(prepareHumanInputSubmission).toHaveBeenCalledOnce()
      expect(mocks.submitWebApp).not.toHaveBeenCalled()

      await act(async () => resolvePreparation?.(ready))

      if (ready) {
        expect(mocks.submitWebApp).toHaveBeenCalledExactlyOnceWith(
          'token-1',
          { inputs: { name: 'Dify' }, action: 'submit' },
          undefined,
        )
      } else {
        expect(mocks.submitWebApp).not.toHaveBeenCalled()
      }
    },
  )
})
