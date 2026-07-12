import { useEffect, useLayoutEffect } from 'react'
import { useStore, useWorkflowStore } from '../store'
import {
  isControlMode,
  isFiniteNumber,
  useDebugPreviewPanelWidthValue,
  useWorkflowNodePanelWidthValue,
  useWorkflowOperationMode,
  useWorkflowVariableInspectPanelHeightValue,
} from './local-storage-options'

export const WorkflowLocalStorageBridge = () => {
  const storedNodePanelWidth = useWorkflowNodePanelWidthValue()
  const storedPreviewPanelWidth = useDebugPreviewPanelWidthValue()
  const storedVariableInspectPanelHeight = useWorkflowVariableInspectPanelHeightValue()
  const [storedControlMode, setControlModeStorage] = useWorkflowOperationMode()

  const workflowStore = useWorkflowStore()
  const setNodePanelWidth = useStore(state => state.setNodePanelWidth)
  const setPanelWidth = useStore(state => state.setPanelWidth)
  const setPreviewPanelWidth = useStore(state => state.setPreviewPanelWidth)
  const setVariableInspectPanelHeight = useStore(state => state.setVariableInspectPanelHeight)
  const setControlMode = useStore(state => state.setControlMode)

  useLayoutEffect(() => {
    if (!isFiniteNumber(storedNodePanelWidth))
      return

    setNodePanelWidth(storedNodePanelWidth)
    setPanelWidth(storedNodePanelWidth)
  }, [setNodePanelWidth, setPanelWidth, storedNodePanelWidth])

  useLayoutEffect(() => {
    if (isFiniteNumber(storedPreviewPanelWidth))
      setPreviewPanelWidth(storedPreviewPanelWidth)
  }, [setPreviewPanelWidth, storedPreviewPanelWidth])

  useLayoutEffect(() => {
    if (isFiniteNumber(storedVariableInspectPanelHeight))
      setVariableInspectPanelHeight(storedVariableInspectPanelHeight)
  }, [setVariableInspectPanelHeight, storedVariableInspectPanelHeight])

  useLayoutEffect(() => {
    if (isControlMode(storedControlMode))
      setControlMode(storedControlMode)
  }, [setControlMode, storedControlMode])

  useEffect(() => {
    let previousControlMode = workflowStore.getState().controlMode

    return workflowStore.subscribe((state) => {
      if (state.controlMode !== previousControlMode) {
        previousControlMode = state.controlMode
        setControlModeStorage(state.controlMode)
      }
    })
  }, [setControlModeStorage, workflowStore])

  return null
}
