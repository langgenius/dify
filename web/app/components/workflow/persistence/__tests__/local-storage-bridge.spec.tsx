import { render, waitFor } from '@testing-library/react'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store/workflow'
import { ControlMode } from '../../types'
import { WorkflowLocalStorageBridge } from '../local-storage-bridge'

describe('WorkflowLocalStorageBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('hydrates workflow preferences from localStorage', async () => {
    localStorage.setItem('workflow-node-panel-width', '460')
    localStorage.setItem('debug-and-preview-panel-width', '520')
    localStorage.setItem('workflow-variable-inpsect-panel-height', '240')
    localStorage.setItem('workflow-operation-mode', ControlMode.Hand)

    const store = createWorkflowStore({})

    render(
      <WorkflowContext value={store}>
        <WorkflowLocalStorageBridge />
      </WorkflowContext>,
    )

    await waitFor(() => {
      expect(store.getState().nodePanelWidth).toBe(460)
      expect(store.getState().panelWidth).toBe(460)
      expect(store.getState().previewPanelWidth).toBe(520)
      expect(store.getState().variableInspectPanelHeight).toBe(240)
      expect(store.getState().controlMode).toBe(ControlMode.Hand)
    })
  })

  it('persists control mode updates from the workflow store', async () => {
    const store = createWorkflowStore({})

    render(
      <WorkflowContext value={store}>
        <WorkflowLocalStorageBridge />
      </WorkflowContext>,
    )

    store.getState().setControlMode(ControlMode.Comment)

    await waitFor(() => {
      expect(localStorage.getItem('workflow-operation-mode')).toBe(ControlMode.Comment)
    })
  })
})
