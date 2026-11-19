import { screen } from '@testing-library/react'
import { ReactFlowProvider } from 'reactflow'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import Record from '../../panel/record'
import RunningTitle from '../running-title'

vi.mock('../../hooks/use-workflow', () => ({
  useIsChatMode: () => false,
}))

vi.mock('@/app/components/workflow/run', () => ({
  default: () => null,
}))

describe('Paused workflow history titles', () => {
  it.each([
    { name: 'history header', Component: RunningTitle },
    { name: 'run detail panel', Component: Record },
  ])('shows the persisted paused state in the $name', ({ Component }) => {
    renderWorkflowComponent(
      <ReactFlowProvider>
        <Component />
      </ReactFlowProvider>,
      {
        initialStoreState: {
          historyWorkflowData: { id: 'paused-run', status: 'paused' },
        },
        hooksStoreProps: {
          getWorkflowRunAndTraceUrl: () => ({
            runUrl: '/runs/paused-run',
            traceUrl: '/runs/paused-run/trace',
          }),
        },
      },
    )

    expect(screen.getByText('Test Run (Paused)')).toBeInTheDocument()
    expect(screen.queryByText('Test Run (Running)')).not.toBeInTheDocument()
  })
})
