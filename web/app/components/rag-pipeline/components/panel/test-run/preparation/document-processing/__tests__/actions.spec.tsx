import type { CustomActionsProps } from '@/app/components/base/form/components/form/actions'
import { fireEvent, render, screen } from '@testing-library/react'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import Actions from '../actions'

let mockWorkflowRunningData: { result: { status: WorkflowRunningStatus } } | undefined

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { workflowRunningData: typeof mockWorkflowRunningData }) => unknown) => selector({
    workflowRunningData: mockWorkflowRunningData,
  }),
}))

const createFormParams = (overrides: Partial<CustomActionsProps> = {}): CustomActionsProps => ({
  form: {
    handleSubmit: vi.fn(),
  } as unknown as CustomActionsProps['form'],
  isSubmitting: false,
  canSubmit: true,
  ...overrides,
})

describe('Document processing actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowRunningData = undefined
  })

  it('should render back/process actions and trigger both callbacks', () => {
    const onBack = vi.fn()
    const formParams = createFormParams()

    render(<Actions formParams={formParams} onBack={onBack} />)

    fireEvent.click(screen.getByRole('button', { name: 'datasetPipeline.operations.backToDataSource' }))
    fireEvent.click(screen.getByRole('button', { name: 'datasetPipeline.operations.process' }))

    expect(onBack).toHaveBeenCalledTimes(1)
    expect(formParams.form.handleSubmit).toHaveBeenCalledTimes(1)
  })

  it('should disable processing when runDisabled or the workflow is already running', () => {
    const { rerender } = render(
      <Actions
        formParams={createFormParams()}
        onBack={vi.fn()}
        runDisabled
      />,
    )

    expect(screen.getByRole('button', { name: 'datasetPipeline.operations.process' })).toBeDisabled()

    mockWorkflowRunningData = {
      result: {
        status: WorkflowRunningStatus.Running,
      },
    }
    rerender(
      <Actions
        formParams={createFormParams()}
        onBack={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /datasetPipeline\.operations\.process/i })).toBeDisabled()
  })
})
