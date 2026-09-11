import type { WorkflowRunningData } from '../../types'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from 'reactflow'
import { createWorkflowRunningData } from '../../__tests__/fixtures'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { WorkflowRunningStatus } from '../../types'
import WorkflowPreview from '../workflow-preview'

vi.mock('../../hooks/use-workflow-panel-interactions', () => ({
  useWorkflowInteractions: () => ({ handleCancelDebugAndPreviewPanel: vi.fn() }),
}))

const createLiveRun = (result: Partial<WorkflowRunningData['result']> = {}): WorkflowRunningData =>
  createWorkflowRunningData({
    result: {
      id: 'live-run-1',
      workflow_id: 'workflow-1',
      status: WorkflowRunningStatus.Failed,
      error: 'Live run failed',
      inputs_truncated: false,
      process_data_truncated: false,
      outputs_truncated: false,
      ...result,
    },
  })

describe('WorkflowPreview Fix', () => {
  it('opens Fix for the latest live run from Detail and hides it on other tabs', async () => {
    const user = userEvent.setup()
    const onFixRun = vi.fn()
    const { store } = renderWorkflowComponent(
      <ReactFlowProvider>
        <WorkflowPreview onFixRun={onFixRun} />
      </ReactFlowProvider>,
      { initialStoreState: { workflowRunningData: createLiveRun() } },
    )

    await user.click(await screen.findByRole('button', { name: 'workflow.difyBuilder.fixRun' }))
    expect(onFixRun).toHaveBeenLastCalledWith('live-run-1')

    await user.click(screen.getByRole('button', { name: 'runLog.result' }))
    expect(screen.queryByRole('button', { name: /difyBuilder\.fix/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'runLog.tracing' }))
    expect(screen.queryByRole('button', { name: /difyBuilder\.fix/ })).not.toBeInTheDocument()

    act(() => store.setState({ workflowRunningData: createLiveRun({ id: 'live-run-2' }) }))
    await user.click(await screen.findByRole('button', { name: 'workflow.difyBuilder.fixRun' }))
    expect(onFixRun).toHaveBeenLastCalledWith('live-run-2')
    expect(onFixRun).toHaveBeenCalledTimes(2)
  })

  it('prevents Fix when the Builder integration disables the entry', async () => {
    const user = userEvent.setup()
    const onFixRun = vi.fn()
    renderWorkflowComponent(
      <ReactFlowProvider>
        <WorkflowPreview onFixRun={onFixRun} fixWithBuilderDisabled />
      </ReactFlowProvider>,
      { initialStoreState: { workflowRunningData: createLiveRun() } },
    )

    const button = await screen.findByRole('button', { name: 'workflow.difyBuilder.fixRun' })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(onFixRun).not.toHaveBeenCalled()
  })

  it.each([
    { status: WorkflowRunningStatus.Running },
    { status: WorkflowRunningStatus.Succeeded },
    { id: undefined },
  ])('does not offer Fix for an ineligible live result: %j', async (result) => {
    const user = userEvent.setup()
    renderWorkflowComponent(
      <ReactFlowProvider>
        <WorkflowPreview onFixRun={vi.fn()} />
      </ReactFlowProvider>,
      { initialStoreState: { workflowRunningData: createLiveRun(result) } },
    )

    await user.click(screen.getByRole('button', { name: 'runLog.detail' }))
    expect(screen.queryByRole('button', { name: /difyBuilder\.fix/ })).not.toBeInTheDocument()
  })
})
