import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRagPipelineSliceSlice } from '@/app/components/rag-pipeline/store'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import GlobalVariableButton from '../global-variable-button'

describe('GlobalVariableButton', () => {
  it('should open the global variable panel and close the other panels when clicked', async () => {
    const user = userEvent.setup()
    const { store } = renderWorkflowComponent(<GlobalVariableButton disabled={false} />, {
      injectWorkflowStoreSliceFn: createRagPipelineSliceSlice,
      initialStoreState: {
        showInputFieldPanel: true,
        showInputFieldPreviewPanel: true,
        inputFieldEditPanelProps: { onSubmit: () => {}, onClose: () => {} },
        showEnvPanel: true,
        showChatVariablePanel: true,
        showDebugAndPreviewPanel: true,
      },
    })

    await user.click(screen.getByRole('button', { name: 'workflow.globalVar.title' }))

    expect(store.getState().showGlobalVariablePanel).toBe(true)
    expect(store.getState().showEnvPanel).toBe(false)
    expect(store.getState().showChatVariablePanel).toBe(false)
    expect(store.getState().showDebugAndPreviewPanel).toBe(false)
    expect(store.getState()).toMatchObject({
      showInputFieldPanel: false,
      showInputFieldPreviewPanel: false,
      inputFieldEditPanelProps: null,
    })
  })

  it('should keep the button disabled when the disabled prop is true', async () => {
    const user = userEvent.setup()
    const { store } = renderWorkflowComponent(<GlobalVariableButton disabled />, {
      injectWorkflowStoreSliceFn: createRagPipelineSliceSlice,
      initialStoreState: {
        showInputFieldPanel: true,
        showInputFieldPreviewPanel: true,
        inputFieldEditPanelProps: { onSubmit: () => {}, onClose: () => {} },
        showGlobalVariablePanel: false,
      },
    })

    await user.click(screen.getByRole('button', { name: 'workflow.globalVar.title' }))

    expect(screen.getByRole('button', { name: 'workflow.globalVar.title' })).toBeDisabled()
    expect(store.getState().showGlobalVariablePanel).toBe(false)
    expect(store.getState()).toMatchObject({
      showInputFieldPanel: true,
      showInputFieldPreviewPanel: true,
      inputFieldEditPanelProps: expect.objectContaining({ onSubmit: expect.any(Function) }),
    })
  })
})
