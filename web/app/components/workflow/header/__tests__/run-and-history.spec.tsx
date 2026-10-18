import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { fullWorkflowAccessControl } from '../../hooks-store/store'
import RunAndHistory from '../run-and-history'

const startPreview = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/use-workflow-start-run', () => ({
  useWorkflowStartRun: () => ({ handleWorkflowStartRunInChatflow: startPreview }),
}))
vi.mock('../view-history', () => ({ default: () => null }))
vi.mock('../checklist', () => ({ default: () => null }))

it('passes denied run permission to a custom run control', async () => {
  const user = userEvent.setup()
  const startRun = vi.fn()
  const CustomRunMode = ({ text, disabled }: { text?: string; disabled?: boolean }) => (
    <button type="button" disabled={disabled} onClick={startRun}>
      {text}
    </button>
  )
  renderWorkflowComponent(
    <RunAndHistory
      showRunButton
      runButtonText="Test Run"
      components={{ RunMode: CustomRunMode }}
    />,
    {
      hooksStoreProps: { accessControl: { ...fullWorkflowAccessControl, canRun: false } },
    },
  )

  const run = screen.getByRole('button', { name: 'Test Run' })
  expect(run).toBeDisabled()
  await user.click(run)
  expect(startRun).not.toHaveBeenCalled()
})

it('keeps preview visible but prevents starting it when run permission is denied', async () => {
  const user = userEvent.setup()
  renderWorkflowComponent(<RunAndHistory showPreviewButton />, {
    hooksStoreProps: { accessControl: { ...fullWorkflowAccessControl, canRun: false } },
  })

  const preview = screen.getByRole('button', { name: 'workflow.common.debugAndPreview' })
  expect(preview).toBeDisabled()
  await user.click(preview)
  expect(startPreview).not.toHaveBeenCalled()
})
