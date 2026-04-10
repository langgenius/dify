import type { WorkflowRunningData } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import Tab from '../tab'

const createWorkflowRunningData = (): WorkflowRunningData => ({
  task_id: 'task-1',
  message_id: 'message-1',
  conversation_id: 'conversation-1',
  result: {
    workflow_id: 'workflow-1',
    inputs: '{}',
    inputs_truncated: false,
    process_data: '{}',
    process_data_truncated: false,
    outputs: '{}',
    outputs_truncated: false,
    status: 'succeeded',
    elapsed_time: 10,
    total_tokens: 20,
    created_at: Date.now(),
    finished_at: Date.now(),
    steps: 1,
    total_steps: 1,
  },
  tracing: [],
})

describe('Tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render an active tab and pass its value on click', () => {
    const onClick = vi.fn()
    render(
      <Tab
        isActive
        label="Preview"
        value="preview"
        workflowRunningData={createWorkflowRunningData()}
        onClick={onClick}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    expect(screen.getByRole('button')).toHaveClass('border-util-colors-blue-brand-blue-brand-600')
    expect(onClick).toHaveBeenCalledWith('preview')
  })

  it('should disable the tab when workflow run data is unavailable', () => {
    render(
      <Tab
        isActive={false}
        label="Trace"
        value="trace"
        onClick={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Trace' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Trace' })).toHaveClass('opacity-30')
  })
})
