import type { WorkflowProcess } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import WorkflowProcessItem from './workflow-process'

// Mock TracingPanel as it's a complex child component
vi.mock('@/app/components/workflow/run/tracing-panel', () => ({
  default: () => <div data-testid="tracing-panel">Tracing Panel</div>,
}))

describe('WorkflowProcessItem', () => {
  const mockData = {
    status: WorkflowRunningStatus.Succeeded,
    tracing: [
      { id: '1', title: 'Start' },
      { id: '2', title: 'End' },
    ],
  }

  it('should render the latest node title when collapsed', () => {
    render(<WorkflowProcessItem data={mockData as WorkflowProcess} expand={false} />)
    expect(screen.getByTestId('workflow-process-title')).toHaveTextContent('End')
    expect(screen.queryByTestId('tracing-panel')).not.toBeInTheDocument()
  })

  it('should render "Workflow Process" title and TracingPanel when expanded', () => {
    // We expect t('common.workflowProcess', { ns: 'workflow' }) to be called
    render(<WorkflowProcessItem data={mockData as WorkflowProcess} expand={true} />)
    expect(screen.getByText(/workflowProcess/i)).toBeInTheDocument()
    expect(screen.getByTestId('tracing-panel')).toBeInTheDocument()
  })

  it('should toggle collapse state on header click', async () => {
    const user = userEvent.setup()
    render(<WorkflowProcessItem data={mockData as WorkflowProcess} expand={false} />)

    const header = screen.getByTestId('workflow-process-header')

    // Expand
    await user.click(header)
    expect(screen.getByTestId('tracing-panel')).toBeInTheDocument()
    expect(screen.getByText(/workflowProcess/i)).toBeInTheDocument()

    // Collapse
    await user.click(header)
    expect(screen.queryByTestId('tracing-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('workflow-process-title')).toHaveTextContent('End')
  })

  it('should render nothing if readonly is true', () => {
    const { container } = render(<WorkflowProcessItem data={mockData as WorkflowProcess} readonly={true} />)
    expect(container.firstChild).toBeNull()
  })

  describe('Status Icons', () => {
    it('should show running spinner when status is Running', () => {
      render(<WorkflowProcessItem data={{ ...mockData, status: WorkflowRunningStatus.Running } as WorkflowProcess} />)
      expect(screen.getByTestId('status-icon-running')).toBeInTheDocument()
    })

    it('should show success circle when status is Succeeded', () => {
      render(<WorkflowProcessItem data={{ ...mockData, status: WorkflowRunningStatus.Succeeded } as WorkflowProcess} />)
      expect(screen.getByTestId('status-icon-success')).toBeInTheDocument()
    })

    it('should show error warning when status is Failed', () => {
      render(<WorkflowProcessItem data={{ ...mockData, status: WorkflowRunningStatus.Failed } as WorkflowProcess} />)
      expect(screen.getByTestId('status-icon-failed')).toBeInTheDocument()
    })

    it('should show error warning when status is Stopped', () => {
      render(<WorkflowProcessItem data={{ ...mockData, status: WorkflowRunningStatus.Stopped } as WorkflowProcess} />)
      expect(screen.getByTestId('status-icon-failed')).toBeInTheDocument()
    })

    it('should show pause circle when status is Paused', () => {
      render(<WorkflowProcessItem data={{ ...mockData, status: WorkflowRunningStatus.Paused } as WorkflowProcess} />)
      expect(screen.getByTestId('status-icon-paused')).toBeInTheDocument()
    })
  })

  describe('Background Colors', () => {
    it('should apply correct background when collapsed for different statuses', () => {
      const { rerender } = render(<WorkflowProcessItem data={{ ...mockData, status: WorkflowRunningStatus.Succeeded } as WorkflowProcess} />)
      expect(screen.getByTestId('workflow-process-item')).toHaveClass('bg-workflow-process-bg')

      rerender(<WorkflowProcessItem data={{ ...mockData, status: WorkflowRunningStatus.Paused } as WorkflowProcess} />)
      expect(screen.getByTestId('workflow-process-item')).toHaveClass('bg-workflow-process-paused-bg')

      rerender(<WorkflowProcessItem data={{ ...mockData, status: WorkflowRunningStatus.Failed } as WorkflowProcess} />)
      expect(screen.getByTestId('workflow-process-item')).toHaveClass('bg-workflow-process-failed-bg')
    })

    it('should apply correct background when expanded for different statuses', () => {
      const { rerender } = render(<WorkflowProcessItem data={{ ...mockData, status: WorkflowRunningStatus.Running } as WorkflowProcess} expand={true} />)
      expect(screen.getByTestId('workflow-process-item')).toHaveClass('bg-background-section-burn')

      rerender(<WorkflowProcessItem data={{ ...mockData, status: WorkflowRunningStatus.Succeeded } as WorkflowProcess} expand={true} />)
      expect(screen.getByTestId('workflow-process-item')).toHaveClass('bg-state-success-hover')

      rerender(<WorkflowProcessItem data={{ ...mockData, status: WorkflowRunningStatus.Failed } as WorkflowProcess} expand={true} />)
      expect(screen.getByTestId('workflow-process-item')).toHaveClass('bg-state-destructive-hover')

      rerender(<WorkflowProcessItem data={{ ...mockData, status: WorkflowRunningStatus.Paused } as WorkflowProcess} expand={true} />)
      expect(screen.getByTestId('workflow-process-item')).toHaveClass('bg-state-warning-hover')
    })
  })
})
