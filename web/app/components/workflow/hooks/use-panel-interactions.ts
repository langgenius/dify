import type { MouseEvent } from 'react'
import { useCallback } from 'react'
import { useWorkflowStore } from '../store'

export const usePanelInteractions = () => {
  const workflowStore = useWorkflowStore()

  const handlePaneContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault()
    const container = document.querySelector('#workflow-container')
    const { x, y } = container!.getBoundingClientRect()
    workflowStore.setState({
      panelMenu: {
        top: e.clientY - y,
        left: e.clientX - x,
      },
    })
  }, [workflowStore])

  return {
    handlePaneContextMenu,
  }
}
