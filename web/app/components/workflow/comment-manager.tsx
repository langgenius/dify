import { useEventListener } from 'ahooks'
import { useWorkflowComment } from './hooks/use-workflow-comment'
import { useWorkflowStore } from './store'

const CommentManager = () => {
  const workflowStore = useWorkflowStore()
  const { handleCreateComment, handleCommentCancel } = useWorkflowComment()

  useEventListener('click', (e) => {
    const { controlMode, mousePosition, pendingComment, isCommentPlacing } = workflowStore.getState()
    const target = e.target as HTMLElement
    const isInDropdown = target.closest('[data-mention-dropdown]')
    const isInCommentInput = target.closest('[data-comment-input]')
    const isOnCanvasPane = target.closest('.react-flow__pane')

    if (isCommentPlacing) {
      if (!isInDropdown && !isInCommentInput && isOnCanvasPane) {
        e.preventDefault()
        e.stopPropagation()
        workflowStore.setState({
          pendingComment: mousePosition,
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
        if (pendingComment)
          handleCommentCancel()
        else
          handleCreateComment(mousePosition)
      }
    }
  })

  useEventListener('contextmenu', () => {
    const { isCommentPlacing } = workflowStore.getState()
    if (!isCommentPlacing)
      return
    workflowStore.setState({
      isCommentPlacing: false,
      isCommentQuickAdd: false,
    })
  })

  return null
}

export default CommentManager
