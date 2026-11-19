import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRagPipelineSliceSlice } from '@/app/components/rag-pipeline/store'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import EnvButton from '../env-button'

describe('EnvButton', () => {
  it('should open the environment panel and close the other panels when clicked', async () => {
    const user = userEvent.setup()
    const { store } = renderWorkflowComponent(<EnvButton disabled={false} />, {
      injectWorkflowStoreSliceFn: createRagPipelineSliceSlice,
      initialStoreState: {
        showInputFieldPanel: true,
        showInputFieldPreviewPanel: true,
        inputFieldEditPanelProps: { onSubmit: () => {}, onClose: () => {} },
        showChatVariablePanel: true,
        showGlobalVariablePanel: true,
        showDebugAndPreviewPanel: true,
      },
    })

    await user.click(screen.getByRole('button', { name: 'workflow.env.envPanelTitle' }))

    expect(store.getState().showEnvPanel).toBe(true)
    expect(store.getState().showChatVariablePanel).toBe(false)
    expect(store.getState().showGlobalVariablePanel).toBe(false)
    expect(store.getState().showDebugAndPreviewPanel).toBe(false)
    expect(store.getState()).toMatchObject({
      showInputFieldPanel: false,
      showInputFieldPreviewPanel: false,
      inputFieldEditPanelProps: null,
    })
  })

  it('should keep the button disabled when the disabled prop is true', async () => {
    const user = userEvent.setup()
    const { store } = renderWorkflowComponent(<EnvButton disabled />, {
      injectWorkflowStoreSliceFn: createRagPipelineSliceSlice,
      initialStoreState: {
        showInputFieldPanel: true,
        showInputFieldPreviewPanel: true,
        inputFieldEditPanelProps: { onSubmit: () => {}, onClose: () => {} },
        showEnvPanel: false,
      },
    })

    await user.click(screen.getByRole('button', { name: 'workflow.env.envPanelTitle' }))

    expect(screen.getByRole('button', { name: 'workflow.env.envPanelTitle' })).toBeDisabled()
    expect(store.getState().showEnvPanel).toBe(false)
    expect(store.getState()).toMatchObject({
      showInputFieldPanel: true,
      showInputFieldPreviewPanel: true,
      inputFieldEditPanelProps: expect.objectContaining({ onSubmit: expect.any(Function) }),
    })
  })
})
