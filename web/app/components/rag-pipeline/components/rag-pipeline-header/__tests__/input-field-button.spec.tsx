import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { createRagPipelineSliceSlice } from '../../../store'
import InputFieldButton from '../input-field-button'

it('opens the input field panel and closes the environment panel', async () => {
  const user = userEvent.setup()
  const store = createWorkflowStore({ injectWorkflowStoreSliceFn: createRagPipelineSliceSlice })
  store.setState({ showInputFieldPanel: false, showEnvPanel: true })
  render(
    <WorkflowContext value={store}>
      <InputFieldButton />
    </WorkflowContext>,
  )

  await user.click(screen.getByRole('button', { name: 'datasetPipeline.inputField' }))

  expect(store.getState()).toMatchObject({ showInputFieldPanel: true, showEnvPanel: false })
})
