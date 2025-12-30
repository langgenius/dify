import type { WorkflowHistoryEventMeta } from '../workflow-history-store'
import { debounce } from 'es-toolkit/compat'
import {
  useCallback,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  useStoreApi,
} from 'reactflow'
import { useWorkflowHistoryStore } from '../workflow-history-store'

/**
 * All supported Events that create a new history state.
 * Current limitations:
 * - InputChange events in Node Panels do not trigger state changes.
 * - Resizing UI elements does not trigger state changes.
 */
export const WorkflowHistoryEvent = {
  NodeTitleChange: 'NodeTitleChange',
  NodeDescriptionChange: 'NodeDescriptionChange',
  NodeDragStop: 'NodeDragStop',
  NodeChange: 'NodeChange',
  NodeConnect: 'NodeConnect',
  NodePaste: 'NodePaste',
  NodeDelete: 'NodeDelete',
  EdgeDelete: 'EdgeDelete',
  EdgeDeleteByDeleteBranch: 'EdgeDeleteByDeleteBranch',
  NodeAdd: 'NodeAdd',
  NodeResize: 'NodeResize',
  NoteAdd: 'NoteAdd',
  NoteChange: 'NoteChange',
  NoteDelete: 'NoteDelete',
  LayoutOrganize: 'LayoutOrganize',
} as const

export type WorkflowHistoryEventT = keyof typeof WorkflowHistoryEvent

export const useWorkflowHistory = () => {
  const store = useStoreApi()
  const { store: workflowHistoryStore } = useWorkflowHistoryStore()
  const { t } = useTranslation()

  const [undoCallbacks, setUndoCallbacks] = useState<(() => void)[]>([])
  const [redoCallbacks, setRedoCallbacks] = useState<(() => void)[]>([])

  const onUndo = useCallback((callback: () => void) => {
    setUndoCallbacks(prev => [...prev, callback])
    return () => setUndoCallbacks(prev => prev.filter(cb => cb !== callback))
  }, [])

  const onRedo = useCallback((callback: () => void) => {
    setRedoCallbacks(prev => [...prev, callback])
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
  const saveStateToHistoryRef = useRef(debounce((event: WorkflowHistoryEventT, meta?: WorkflowHistoryEventMeta) => {
    workflowHistoryStore.setState({
      workflowHistoryEvent: event,
      workflowHistoryEventMeta: meta,
      nodes: store.getState().getNodes(),
      edges: store.getState().edges,
    })
  }, 500))

  const saveStateToHistory = useCallback((event: WorkflowHistoryEventT, meta?: WorkflowHistoryEventMeta) => {
    switch (event) {
      case WorkflowHistoryEvent.NoteChange:
        // Hint: Note change does not trigger when note text changes,
        // because the note editors have their own history states.
        saveStateToHistoryRef.current(event, meta)
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
        saveStateToHistoryRef.current(event, meta)
        break
      default:
        // We do not create a history state for every event.
        // Some events of reactflow may change things the user would not want to undo/redo.
        // For example: UI state changes like selecting a node.
        break
    }
  }, [])

  const getHistoryLabel = useCallback((event: WorkflowHistoryEventT) => {
    switch (event) {
      case WorkflowHistoryEvent.NodeTitleChange:
        return t('changeHistory.nodeTitleChange', { ns: 'workflow' })
      case WorkflowHistoryEvent.NodeDescriptionChange:
        return t('changeHistory.nodeDescriptionChange', { ns: 'workflow' })
      case WorkflowHistoryEvent.LayoutOrganize:
      case WorkflowHistoryEvent.NodeDragStop:
        return t('changeHistory.nodeDragStop', { ns: 'workflow' })
      case WorkflowHistoryEvent.NodeChange:
        return t('changeHistory.nodeChange', { ns: 'workflow' })
      case WorkflowHistoryEvent.NodeConnect:
        return t('changeHistory.nodeConnect', { ns: 'workflow' })
      case WorkflowHistoryEvent.NodePaste:
        return t('changeHistory.nodePaste', { ns: 'workflow' })
      case WorkflowHistoryEvent.NodeDelete:
        return t('changeHistory.nodeDelete', { ns: 'workflow' })
      case WorkflowHistoryEvent.NodeAdd:
        return t('changeHistory.nodeAdd', { ns: 'workflow' })
      case WorkflowHistoryEvent.EdgeDelete:
      case WorkflowHistoryEvent.EdgeDeleteByDeleteBranch:
        return t('changeHistory.edgeDelete', { ns: 'workflow' })
      case WorkflowHistoryEvent.NodeResize:
        return t('changeHistory.nodeResize', { ns: 'workflow' })
      case WorkflowHistoryEvent.NoteAdd:
        return t('changeHistory.noteAdd', { ns: 'workflow' })
      case WorkflowHistoryEvent.NoteChange:
        return t('changeHistory.noteChange', { ns: 'workflow' })
      case WorkflowHistoryEvent.NoteDelete:
        return t('changeHistory.noteDelete', { ns: 'workflow' })
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
