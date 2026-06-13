import { createLocalStorageState } from 'foxact/create-local-storage-state'
import { NOTE_SHOW_AUTHOR_STORAGE_KEY } from '../note-node/constants'
import { ControlMode } from '../types'

export const WORKFLOW_NODE_PANEL_WIDTH_KEY = 'workflow-node-panel-width'
export const WORKFLOW_PREVIEW_PANEL_WIDTH_KEY = 'debug-and-preview-panel-width'
export const WORKFLOW_VARIABLE_INSPECT_PANEL_HEIGHT_KEY = 'workflow-variable-inpsect-panel-height'
export const WORKFLOW_OPERATION_MODE_KEY = 'workflow-operation-mode'

export const rawStorageOptions = { raw: true } as const
export const numberStorageOptions = {
  serializer: String,
  deserializer: Number,
} as const

export const isControlMode = (value: string | null): value is ControlMode => {
  return value === ControlMode.Pointer || value === ControlMode.Hand || value === ControlMode.Comment
}

export const isFiniteNumber = (value: number | null): value is number => {
  return value !== null && Number.isFinite(value)
}

export const [
  useWorkflowNodePanelWidth,
  useWorkflowNodePanelWidthValue,
  useSetWorkflowNodePanelWidth,
] = createLocalStorageState<number>(WORKFLOW_NODE_PANEL_WIDTH_KEY, undefined, numberStorageOptions)

export const [
  useDebugPreviewPanelWidth,
  useDebugPreviewPanelWidthValue,
  useSetDebugPreviewPanelWidth,
] = createLocalStorageState<number>(WORKFLOW_PREVIEW_PANEL_WIDTH_KEY, undefined, numberStorageOptions)

export const [
  useWorkflowVariableInspectPanelHeight,
  useWorkflowVariableInspectPanelHeightValue,
  useSetWorkflowVariableInspectPanelHeight,
] = createLocalStorageState<number>(WORKFLOW_VARIABLE_INSPECT_PANEL_HEIGHT_KEY, undefined, numberStorageOptions)

export const [
  useWorkflowOperationMode,
  useWorkflowOperationModeValue,
  useSetWorkflowOperationMode,
] = createLocalStorageState<string>(WORKFLOW_OPERATION_MODE_KEY, undefined, rawStorageOptions)

export const [
  useWorkflowNoteShowAuthor,
  useWorkflowNoteShowAuthorValue,
  useSetWorkflowNoteShowAuthor,
] = createLocalStorageState<string>(NOTE_SHOW_AUTHOR_STORAGE_KEY, 'true', rawStorageOptions)
