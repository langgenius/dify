import { useEventListener } from 'ahooks'
import { useWorkflowStore } from './store'
import { useWorkflowComment } from './hooks/use-workflow-comment'

const CommentManager = () => {
  const workflowStore = useWorkflowStore()
  const { handleCreateComment, handleCommentCancel } = useWorkflowComment()

  useEventListener('click', (e) => {
    const { controlMode, mousePosition, pendingComment } = workflowStore.getState()

    if (controlMode === 'comment') {
      const target = e.target as HTMLElement
      const isInDropdown = target.closest('[data-mention-dropdown]')
      const isInCommentInput = target.closest('[data-comment-input]')
      const isOnCanvasPane = target.closest('.react-flow__pane')

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

  return null
}

export default CommentManager
