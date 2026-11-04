import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNodeTracing } from '@/app/components/workflow/__tests__/fixtures'
import {
  baseRunningData,
  renderWorkflowComponent,
} from '@/app/components/workflow/__tests__/workflow-test-env'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { ChunkingMode } from '@/models/datasets'
import Result from '../index'

// The detail and tracing panels are independently tested run components.
vi.mock('@/app/components/workflow/run/result-panel', () => ({
  default: () => <div>Result detail</div>,
}))

vi.mock('@/app/components/workflow/run/tracing-panel', () => ({
  default: () => <div>Tracing detail</div>,
}))

describe('Result', () => {
  it('switches between preview, detail, and tracing', async () => {
    const user = userEvent.setup()
    renderWorkflowComponent(<Result />, {
      initialStoreState: {
        workflowRunningData: baseRunningData({
          result: {
            status: WorkflowRunningStatus.Succeeded,
            outputs: {
              chunk_structure: ChunkingMode.text,
              preview: [{ content: 'Processed document' }],
            },
          },
          tracing: [createNodeTracing({ id: 'trace-1' })],
        }),
      },
    })

    expect(screen.getByText('Processed document')).toBeInTheDocument()

    await user.tab()
    expect(screen.getByRole('tab', { name: 'runLog.result', selected: true })).toHaveFocus()
    await user.keyboard('{ArrowRight}{Enter}')
    const detailTab = screen.getByRole('tab', { name: 'runLog.detail', selected: true })
    expect(detailTab).toHaveFocus()
    expect(screen.getByRole('tabpanel', { name: 'runLog.detail' })).toHaveAttribute(
      'id',
      detailTab.getAttribute('aria-controls'),
    )
    expect(screen.getByText('Result detail')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'runLog.tracing' }))
    expect(screen.getByText('Tracing detail')).toBeInTheDocument()
  })
})
