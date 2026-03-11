import type { MouseEvent } from 'react'
import { useCallback } from 'react'
import { useWorkflowStore } from '../store'
import { readWorkflowClipboard } from '../utils'

export const usePanelInteractions = () => {
  const workflowStore = useWorkflowStore()

  const handlePaneContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault()
    void readWorkflowClipboard().then(({ nodes, edges }) => {
      if (nodes.length)
        workflowStore.getState().setClipboardData({ nodes, edges })
    })

    const container = document.querySelector('#workflow-container')
    const { x, y } = container!.getBoundingClientRect()
    workflowStore.setState({
      panelMenu: {
        top: e.clientY - y,
        left: e.clientX - x,
      },
    })
  }, [workflowStore])

  const handlePaneContextmenuCancel = useCallback(() => {
    workflowStore.setState({
      panelMenu: undefined,
    })
  }, [workflowStore])

  const handleNodeContextmenuCancel = useCallback(() => {
    workflowStore.setState({
      nodeMenu: undefined,
    })
  }, [workflowStore])

  return {
    handlePaneContextMenu,
    handlePaneContextmenuCancel,
    handleNodeContextmenuCancel,
  }
}
