import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createChatConnections } from '@/app/components/base/chat/chat-with-history/__tests__/connection-fixture'
import { ConnectionsContext } from '@/app/components/share/connections/use-connections'
import { InputVarType, WorkflowRunningStatus } from '@/app/components/workflow/types'
import { AppSourceType, submitHumanInputForm } from '@/service/share'
import { submitHumanInputForm as submitInstalledForm } from '@/service/workflow'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import {
  createHumanInputFormFixture,
  createWorkflowProcessFixture,
} from '@/test/fixtures/workflow-process'
import GenerationItem from '..'

vi.mock('@/next/navigation', () => ({ useParams: () => ({ token: 'current-app' }) }))
vi.mock('@/service/share', async (original) => ({
  ...(await original<typeof import('@/service/share')>()),
  submitHumanInputForm: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/service/workflow', async (original) => ({
  ...(await original<typeof import('@/service/workflow')>()),
  submitHumanInputForm: vi.fn().mockResolvedValue({}),
}))

it.each([AppSourceType.webApp, AppSourceType.installedApp])(
  'preserves a paused review and only gates WebApp submissions on required connections (%s)',
  async (appSourceType) => {
    const user = userEvent.setup()
    const ready = createChatConnections()
    const process = createWorkflowProcessFixture({
      status: WorkflowRunningStatus.Paused,
      resultText: 'Existing result',
      humanInputFormDataList: [
        createHumanInputFormFixture({
          form_content: '{{#$output.review#}}',
          inputs: [
            {
              type: InputVarType.paragraph,
              output_variable_name: 'review',
              default: { type: 'constant', value: '', selector: [] },
            },
          ],
          actions: [{ id: 'approve', title: 'Approve', button_style: 'primary' }],
        }),
      ],
    })
    const tree = (canRun: boolean) => (
      <ConnectionsContext value={{ ...ready, canRun }}>
        <GenerationItem
          isWorkflow
          appSourceType={appSourceType}
          workflowProcessData={process}
          content="Existing result"
          isError={false}
          onRetry={vi.fn()}
          siteInfo={null}
        />
      </ConnectionsContext>
    )
    const view = renderWithConsoleQuery(tree(true))
    const review = await screen.findByRole('textbox', { name: 'review' })
    await screen.findByText('Existing result')
    await user.type(review, 'Keep this review')
    view.rerender(tree(false))
    const approve = screen.getByRole('button', { name: 'Approve' })
    if (appSourceType === AppSourceType.webApp) {
      expect(approve).toBeDisabled()
      await user.click(approve)
      expect(submitHumanInputForm).not.toHaveBeenCalled()
    } else {
      expect(approve).toBeEnabled()
    }
    expect(review).toHaveValue('Keep this review')
    expect(screen.getByText('Existing result')).toBeVisible()

    view.rerender(tree(true))
    await user.click(approve)
    const submit =
      appSourceType === AppSourceType.webApp ? submitHumanInputForm : submitInstalledForm
    expect(submit).toHaveBeenCalledExactlyOnceWith('token-1', {
      inputs: { review: 'Keep this review' },
      action: 'approve',
    })
  },
)
