import type { MouseEvent } from 'react'
import { useCallback } from 'react'
import { useWorkflowStore } from '../store'

export const useSelectionGraphMenu = () => {
  const workflowStore = useWorkflowStore()

  const { setSelectPanelMenu, setNodeMenu, setPanelMenu } = workflowStore.getState()

  const handleSelectPanelContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault()
    console.log('handleSelectPanelContextMenu', e.clientX, e.clientY)
    const container = document.querySelector('#workflow-container')
    const { x, y } = container!.getBoundingClientRect()

    setSelectPanelMenu({
      top: e.clientY - y,
      left: e.clientX - x,
    })
  }, [setSelectPanelMenu])

  const handleSelectPanelContextmenuCancel = useCallback(() => {
    setSelectPanelMenu(undefined)
  }, [setSelectPanelMenu])

  const handleOtherContextmenuCancel = useCallback(() => {
    setNodeMenu(undefined)
    setPanelMenu(undefined)
  }, [setNodeMenu, setPanelMenu])

  return {
    handleSelectPanelContextMenu,
    handleSelectPanelContextmenuCancel,
    handleOtherContextmenuCancel,
  }
}
