import type { CustomActionsProps } from '@/app/components/base/form/components/form/actions'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAppForm, useFormContext } from '@/app/components/base/form'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { expectLoadingButton } from '@/test/button'
import Actions from '../actions'

let mockWorkflowRunningData: { result: { status: WorkflowRunningStatus } } | undefined
vi.mock('@/app/components/workflow/store', () => ({
  useStore: (
    selector: (state: { workflowRunningData: typeof mockWorkflowRunningData }) => unknown,
  ) => selector({ workflowRunningData: mockWorkflowRunningData }),
}))

const Harness = ({
  onSubmit,
  runDisabled = false,
  canSubmit = true,
  isSubmitting = false,
}: Pick<CustomActionsProps, 'canSubmit' | 'isSubmitting'> & {
  onSubmit: () => void
  runDisabled?: boolean
}) => {
  const form = useAppForm({
    defaultValues: {} as Record<string, unknown>,
    onSubmitMeta: {},
    onSubmit,
  })
  return (
    <form.AppForm>
      <FormActions canSubmit={canSubmit} isSubmitting={isSubmitting} runDisabled={runDisabled} />
    </form.AppForm>
  )
}

function FormActions({
  canSubmit,
  isSubmitting,
  runDisabled,
}: {
  canSubmit: boolean
  isSubmitting: boolean
  runDisabled: boolean
}) {
  const form = useFormContext()
  return (
    <Actions
      formParams={{ form, canSubmit, isSubmitting }}
      onBack={vi.fn()}
      runDisabled={runDisabled}
    />
  )
}

beforeEach(() => {
  mockWorkflowRunningData = undefined
})

it.each([
  { reason: 'disabled run', runDisabled: true, canSubmit: true },
  { reason: 'invalid form', runDisabled: false, canSubmit: false },
])('blocks processing for $reason', async ({ runDisabled, canSubmit }) => {
  const user = userEvent.setup()
  const onSubmit = vi.fn()
  render(
    <Harness
      onSubmit={onSubmit}
      runDisabled={runDisabled}
      canSubmit={canSubmit}
      isSubmitting={false}
    />,
  )
  const process = screen.getByRole('button', { name: 'datasetPipeline.operations.process' })
  expect(process).toBeDisabled()
  await user.click(process)
  expect(onSubmit).not.toHaveBeenCalled()
})

it.each(['workflow', 'form'] as const)(
  'prevents duplicate processing while the %s is pending',
  async (pending) => {
    const user = userEvent.setup()
    if (pending === 'workflow')
      mockWorkflowRunningData = { result: { status: WorkflowRunningStatus.Running } }
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} canSubmit={false} isSubmitting={pending === 'form'} />)
    const process = screen.getByRole('button', { name: /datasetPipeline.operations.process/ })
    expectLoadingButton(process)
    await user.click(process)
    expect(onSubmit).not.toHaveBeenCalled()
  },
)
