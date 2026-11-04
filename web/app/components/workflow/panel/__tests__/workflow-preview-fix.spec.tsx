import type { WorkflowRunningData } from '../../types'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from 'reactflow'
import { createWorkflowRunningData } from '../../__tests__/fixtures'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { WorkflowRunningStatus } from '../../types'
import WorkflowPreview from '../workflow-preview'

const getTraceRun = vi.hoisted(() =>
  vi.fn<
    typeof import('@/service/console').consoleClient.apps.byAppId.traceRuns.bySourceKind.bySourceId.get
  >(),
)
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.traceRuns.bySourceKind.bySourceId.get': getTraceRun,
    }),
  }
})

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

describe('WorkflowPreview failure actions', () => {
  beforeEach(() => {
    getTraceRun.mockImplementation(async ({ params }) => ({
      status: 'not_collected',
      source_kind: params.source_kind,
      source_id: params.source_id,
    }))
  })

  it('opens failure actions for the latest live run from Detail and hides it on other tabs', async () => {
    const user = userEvent.setup()
    const onFixRun = vi.fn()
    const { store } = renderWorkflowComponent(
      <ReactFlowProvider>
        <WorkflowPreview
          renderFailureActions={(runId) => (
            <button type="button" onClick={() => onFixRun(runId)}>
              Recover run
            </button>
          )}
        />
      </ReactFlowProvider>,
      { initialStoreState: { workflowRunningData: createLiveRun() } },
    )

    await user.click(await screen.findByRole('button', { name: 'Recover run' }))
    expect(onFixRun).toHaveBeenLastCalledWith('live-run-1')

    await user.click(screen.getByRole('button', { name: 'runLog.result' }))
    expect(screen.queryByRole('button', { name: 'Recover run' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'runLog.tracing' }))
    expect(screen.queryByRole('button', { name: 'Recover run' })).not.toBeInTheDocument()

    act(() => store.setState({ workflowRunningData: createLiveRun({ id: 'live-run-2' }) }))
    await user.click(await screen.findByRole('button', { name: 'Recover run' }))
    expect(onFixRun).toHaveBeenLastCalledWith('live-run-2')
    expect(onFixRun).toHaveBeenCalledTimes(2)
  })

  it('preserves the disabled state of supplied failure actions', async () => {
    const user = userEvent.setup()
    const onFixRun = vi.fn()
    renderWorkflowComponent(
      <ReactFlowProvider>
        <WorkflowPreview
          renderFailureActions={(runId) => (
            <button type="button" disabled onClick={() => onFixRun(runId)}>
              Recover run
            </button>
          )}
        />
      </ReactFlowProvider>,
      { initialStoreState: { workflowRunningData: createLiveRun() } },
    )

    const button = await screen.findByRole('button', { name: 'Recover run' })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(onFixRun).not.toHaveBeenCalled()
  })

  it.each([
    { status: WorkflowRunningStatus.Running },
    { status: WorkflowRunningStatus.Succeeded },
    { id: undefined },
  ])('does not offer recovery actions for an ineligible live result: %j', async (result) => {
    const user = userEvent.setup()
    renderWorkflowComponent(
      <ReactFlowProvider>
        <WorkflowPreview renderFailureActions={() => <button type="button">Recover run</button>} />
      </ReactFlowProvider>,
      { initialStoreState: { workflowRunningData: createLiveRun(result) } },
    )

    await user.click(screen.getByRole('button', { name: 'runLog.detail' }))
    expect(screen.queryByRole('button', { name: 'Recover run' })).not.toBeInTheDocument()
  })
})
