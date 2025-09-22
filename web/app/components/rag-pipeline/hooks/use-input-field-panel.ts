import { useCallback, useMemo } from 'react'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import type { InputFieldEditorProps } from '../components/panel/input-field/editor'

export const useInputFieldPanel = () => {
  const workflowStore = useWorkflowStore()
  const showInputFieldPreviewPanel = useStore(state => state.showInputFieldPreviewPanel)
  const inputFieldEditPanelProps = useStore(state => state.inputFieldEditPanelProps)

  const isPreviewing = useMemo(() => {
    return showInputFieldPreviewPanel
  }, [showInputFieldPreviewPanel])

  const isEditing = useMemo(() => {
    return !!inputFieldEditPanelProps
  }, [inputFieldEditPanelProps])

  const closeAllInputFieldPanels = useCallback(() => {
    const {
      setShowInputFieldPanel,
      setShowInputFieldPreviewPanel,
      setInputFieldEditPanelProps,
    } = workflowStore.getState()

    setShowInputFieldPanel?.(false)
    setShowInputFieldPreviewPanel?.(false)
    setInputFieldEditPanelProps?.(null)
  }, [workflowStore])

  const toggleInputFieldPreviewPanel = useCallback(() => {
    const {
      showInputFieldPreviewPanel,
      setShowInputFieldPreviewPanel,
    } = workflowStore.getState()

    setShowInputFieldPreviewPanel?.(!showInputFieldPreviewPanel)
  }, [workflowStore])

  const toggleInputFieldEditPanel = useCallback((editContent: InputFieldEditorProps | null) => {
    const {
      setInputFieldEditPanelProps,
    } = workflowStore.getState()

    setInputFieldEditPanelProps?.(editContent)
  }, [workflowStore])

  return {
    closeAllInputFieldPanels,
    toggleInputFieldPreviewPanel,
    toggleInputFieldEditPanel,
    isPreviewing,
    isEditing,
  }
}
