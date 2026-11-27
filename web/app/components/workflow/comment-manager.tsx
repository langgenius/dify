import { useEventListener } from 'ahooks'
import { useReactFlow } from 'reactflow'
import { useWorkflowStore } from './store'

const CommentManager = () => {
  const workflowStore = useWorkflowStore()
  const { screenToFlowPosition } = useReactFlow()

  useEventListener('click', (e) => {
    const { controlMode, pendingComment, isCommentPlacing } = workflowStore.getState()
    const target = e.target as HTMLElement
    const isInDropdown = target.closest('[data-mention-dropdown]')
    const isInCommentInput = target.closest('[data-comment-input]')
    const isOnCanvasPane = target.closest('.react-flow__pane')
    const pointed = () => screenToFlowPosition({ x: e.clientX, y: e.clientY })

    if (isCommentPlacing) {
      if (!isInDropdown && !isInCommentInput && isOnCanvasPane) {
        e.preventDefault()
        e.stopPropagation()
        workflowStore.setState({
          pendingComment: pointed(),
          isCommentPlacing: false,
        })
      }
      return
    }

    if (controlMode === 'comment') {
      // Only when clicking on the React Flow canvas pane (background),
      // and not inside comment input or its dropdown
      if (!isInDropdown && !isInCommentInput && isOnCanvasPane) {
        e.preventDefault()
        e.stopPropagation()
        if (pendingComment) workflowStore.getState().setPendingComment(null)
        else workflowStore.getState().setPendingComment(pointed())
      }
    }
  })

  useEventListener('contextmenu', () => {
    const { isCommentPlacing } = workflowStore.getState()
    if (!isCommentPlacing) return
    workflowStore.setState({
      isCommentPlacing: false,
      isCommentQuickAdd: false,
    })
  })

  return null
}

export default CommentManager
