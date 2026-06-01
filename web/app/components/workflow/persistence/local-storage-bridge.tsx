import { useEffect, useLayoutEffect as useLayoutEffectFromReact } from 'react'
import { useLocalStorage, useSetLocalStorage } from '@/hooks/use-local-storage'
import { useStore, useWorkflowStore } from '../store'
import {
  isControlMode,
  isFiniteNumber,
  numberStorageOptions,
  rawStorageOptions,
  WORKFLOW_NODE_PANEL_WIDTH_KEY,
  WORKFLOW_OPERATION_MODE_KEY,
  WORKFLOW_PREVIEW_PANEL_WIDTH_KEY,
  WORKFLOW_VARIABLE_INSPECT_PANEL_HEIGHT_KEY,
} from './local-storage-options'

const useIsomorphicLayoutEffect = typeof window === 'undefined'
  ? useEffect
  : useLayoutEffectFromReact

export const WorkflowLocalStorageBridge = () => {
  const [storedNodePanelWidth] = useLocalStorage<number>(WORKFLOW_NODE_PANEL_WIDTH_KEY, undefined, numberStorageOptions)
  const [storedPreviewPanelWidth] = useLocalStorage<number>(WORKFLOW_PREVIEW_PANEL_WIDTH_KEY, undefined, numberStorageOptions)
  const [storedVariableInspectPanelHeight] = useLocalStorage<number>(WORKFLOW_VARIABLE_INSPECT_PANEL_HEIGHT_KEY, undefined, numberStorageOptions)
  const [storedControlMode] = useLocalStorage<string>(WORKFLOW_OPERATION_MODE_KEY, undefined, rawStorageOptions)

  const workflowStore = useWorkflowStore()
  const setNodePanelWidth = useStore(state => state.setNodePanelWidth)
  const setPanelWidth = useStore(state => state.setPanelWidth)
  const setPreviewPanelWidth = useStore(state => state.setPreviewPanelWidth)
  const setVariableInspectPanelHeight = useStore(state => state.setVariableInspectPanelHeight)
  const setControlMode = useStore(state => state.setControlMode)

  const setControlModeStorage = useSetLocalStorage<string>(WORKFLOW_OPERATION_MODE_KEY, rawStorageOptions)

  useIsomorphicLayoutEffect(() => {
    if (!isFiniteNumber(storedNodePanelWidth))
      return

    setNodePanelWidth(storedNodePanelWidth)
    setPanelWidth(storedNodePanelWidth)
  }, [setNodePanelWidth, setPanelWidth, storedNodePanelWidth])

  useIsomorphicLayoutEffect(() => {
    if (isFiniteNumber(storedPreviewPanelWidth))
      setPreviewPanelWidth(storedPreviewPanelWidth)
  }, [setPreviewPanelWidth, storedPreviewPanelWidth])

  useIsomorphicLayoutEffect(() => {
    if (isFiniteNumber(storedVariableInspectPanelHeight))
      setVariableInspectPanelHeight(storedVariableInspectPanelHeight)
  }, [setVariableInspectPanelHeight, storedVariableInspectPanelHeight])

  useIsomorphicLayoutEffect(() => {
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
