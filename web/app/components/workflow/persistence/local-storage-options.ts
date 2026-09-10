import { createLocalStorageState } from 'foxact/create-local-storage-state'
import { NOTE_SHOW_AUTHOR_STORAGE_KEY } from '../note-node/constants'
import { ControlMode } from '../types'

const WORKFLOW_NODE_PANEL_WIDTH_KEY = 'workflow-node-panel-width'
const WORKFLOW_PREVIEW_PANEL_WIDTH_KEY = 'debug-and-preview-panel-width'
const WORKFLOW_VARIABLE_INSPECT_PANEL_HEIGHT_KEY = 'workflow-variable-inpsect-panel-height'
const WORKFLOW_OPERATION_MODE_KEY = 'workflow-operation-mode'

const rawStorageOptions = { raw: true } as const
const numberStorageOptions = {
  serializer: String,
  deserializer: Number,
} as const

export const isControlMode = (value: string | null): value is ControlMode => {
  return (
    value === ControlMode.Pointer || value === ControlMode.Hand || value === ControlMode.Comment
  )
}

export const isFiniteNumber = (value: number | null): value is number => {
  return value !== null && Number.isFinite(value)
}

const [_useWorkflowNodePanelWidth, useWorkflowNodePanelWidthValue, useSetWorkflowNodePanelWidth] =
  createLocalStorageState<number>(WORKFLOW_NODE_PANEL_WIDTH_KEY, undefined, numberStorageOptions)

const [_useDebugPreviewPanelWidth, useDebugPreviewPanelWidthValue, useSetDebugPreviewPanelWidth] =
  createLocalStorageState<number>(WORKFLOW_PREVIEW_PANEL_WIDTH_KEY, undefined, numberStorageOptions)

const [
  _useWorkflowVariableInspectPanelHeight,
  useWorkflowVariableInspectPanelHeightValue,
  useSetWorkflowVariableInspectPanelHeight,
] = createLocalStorageState<number>(
  WORKFLOW_VARIABLE_INSPECT_PANEL_HEIGHT_KEY,
  undefined,
  numberStorageOptions,
)

const [useWorkflowOperationMode, _useWorkflowOperationModeValue, _useSetWorkflowOperationMode] =
  createLocalStorageState<string>(WORKFLOW_OPERATION_MODE_KEY, undefined, rawStorageOptions)

const [_useWorkflowNoteShowAuthor, useWorkflowNoteShowAuthorValue, useSetWorkflowNoteShowAuthor] =
  createLocalStorageState<string>(NOTE_SHOW_AUTHOR_STORAGE_KEY, 'true', rawStorageOptions)

export {
  useDebugPreviewPanelWidthValue,
  useSetDebugPreviewPanelWidth,
  useSetWorkflowNodePanelWidth,
  useSetWorkflowNoteShowAuthor,
  useSetWorkflowVariableInspectPanelHeight,
  useWorkflowNodePanelWidthValue,
  useWorkflowNoteShowAuthorValue,
  useWorkflowOperationMode,
  useWorkflowVariableInspectPanelHeightValue,
}
