import {
  useCallback,
  useRef, useState,
} from 'react'
import { debounce } from 'lodash-es'
import {
  useStoreApi,
} from 'reactflow'
import { useTranslation } from 'react-i18next'
import { useWorkflowHistoryStore } from '../workflow-history-store'

/**
 * All supported Events that create a new history state.
 * Current limitations:
 * - InputChange events in Node Panels do not trigger state changes.
 * - Resizing UI elements does not trigger state changes.
 */
export enum WorkflowHistoryEvent {
  NodeTitleChange = 'NodeTitleChange',
  NodeDescriptionChange = 'NodeDescriptionChange',
  NodeDragStop = 'NodeDragStop',
  NodeChange = 'NodeChange',
  NodeConnect = 'NodeConnect',
  NodePaste = 'NodePaste',
  NodeDelete = 'NodeDelete',
  EdgeDelete = 'EdgeDelete',
  EdgeDeleteByDeleteBranch = 'EdgeDeleteByDeleteBranch',
  NodeAdd = 'NodeAdd',
  NodeResize = 'NodeResize',
  NoteAdd = 'NoteAdd',
  NoteChange = 'NoteChange',
  NoteDelete = 'NoteDelete',
  LayoutOrganize = 'LayoutOrganize',
}

export const useWorkflowHistory = () => {
  const store = useStoreApi()
  const { store: workflowHistoryStore } = useWorkflowHistoryStore()
  const { t } = useTranslation()

  const [undoCallbacks, setUndoCallbacks] = useState<any[]>([])
  const [redoCallbacks, setRedoCallbacks] = useState<any[]>([])

  const onUndo = useCallback((callback: unknown) => {
    setUndoCallbacks((prev: any) => [...prev, callback])
    return () => setUndoCallbacks(prev => prev.filter(cb => cb !== callback))
  }, [])

  const onRedo = useCallback((callback: unknown) => {
    setRedoCallbacks((prev: any) => [...prev, callback])
    return () => setRedoCallbacks(prev => prev.filter(cb => cb !== callback))
  }, [])

  const undo = useCallback(() => {
    workflowHistoryStore.temporal.getState().undo()
    undoCallbacks.forEach(callback => callback())
  }, [undoCallbacks, workflowHistoryStore.temporal])

  const redo = useCallback(() => {
    workflowHistoryStore.temporal.getState().redo()
    redoCallbacks.forEach(callback => callback())
  }, [redoCallbacks, workflowHistoryStore.temporal])

  // Some events may be triggered multiple times in a short period of time.
  // We debounce the history state update to avoid creating multiple history states
  // with minimal changes.
  const saveStateToHistoryRef = useRef(debounce((event: WorkflowHistoryEvent) => {
    workflowHistoryStore.setState({
      workflowHistoryEvent: event,
      nodes: store.getState().getNodes(),
      edges: store.getState().edges,
    })
  }, 500))

  const saveStateToHistory = useCallback((event: WorkflowHistoryEvent) => {
    switch (event) {
      case WorkflowHistoryEvent.NoteChange:
        // Hint: Note change does not trigger when note text changes,
        // because the note editors have their own history states.
        saveStateToHistoryRef.current(event)
        break
      case WorkflowHistoryEvent.NodeTitleChange:
      case WorkflowHistoryEvent.NodeDescriptionChange:
      case WorkflowHistoryEvent.NodeDragStop:
      case WorkflowHistoryEvent.NodeChange:
      case WorkflowHistoryEvent.NodeConnect:
      case WorkflowHistoryEvent.NodePaste:
      case WorkflowHistoryEvent.NodeDelete:
      case WorkflowHistoryEvent.EdgeDelete:
      case WorkflowHistoryEvent.EdgeDeleteByDeleteBranch:
      case WorkflowHistoryEvent.NodeAdd:
      case WorkflowHistoryEvent.NodeResize:
      case WorkflowHistoryEvent.NoteAdd:
      case WorkflowHistoryEvent.LayoutOrganize:
      case WorkflowHistoryEvent.NoteDelete:
        saveStateToHistoryRef.current(event)
        break
      default:
        // We do not create a history state for every event.
        // Some events of reactflow may change things the user would not want to undo/redo.
        // For example: UI state changes like selecting a node.
        break
    }
  }, [])

  const getHistoryLabel = useCallback((event: WorkflowHistoryEvent) => {
    switch (event) {
      case WorkflowHistoryEvent.NodeTitleChange:
        return t('workflow.changeHistory.nodeTitleChange')
      case WorkflowHistoryEvent.NodeDescriptionChange:
        return t('workflow.changeHistory.nodeDescriptionChange')
      case WorkflowHistoryEvent.LayoutOrganize:
      case WorkflowHistoryEvent.NodeDragStop:
        return t('workflow.changeHistory.nodeDragStop')
      case WorkflowHistoryEvent.NodeChange:
        return t('workflow.changeHistory.nodeChange')
      case WorkflowHistoryEvent.NodeConnect:
        return t('workflow.changeHistory.nodeConnect')
      case WorkflowHistoryEvent.NodePaste:
        return t('workflow.changeHistory.nodePaste')
      case WorkflowHistoryEvent.NodeDelete:
        return t('workflow.changeHistory.nodeDelete')
      case WorkflowHistoryEvent.NodeAdd:
        return t('workflow.changeHistory.nodeAdd')
      case WorkflowHistoryEvent.EdgeDelete:
      case WorkflowHistoryEvent.EdgeDeleteByDeleteBranch:
        return t('workflow.changeHistory.edgeDelete')
      case WorkflowHistoryEvent.NodeResize:
        return t('workflow.changeHistory.nodeResize')
      case WorkflowHistoryEvent.NoteAdd:
        return t('workflow.changeHistory.noteAdd')
      case WorkflowHistoryEvent.NoteChange:
        return t('workflow.changeHistory.noteChange')
      case WorkflowHistoryEvent.NoteDelete:
        return t('workflow.changeHistory.noteDelete')
      default:
        return 'Unknown Event'
    }
  }, [t])

  return {
    store: workflowHistoryStore,
    saveStateToHistory,
    getHistoryLabel,
    undo,
    redo,
    onUndo,
    onRedo,
  }
}
