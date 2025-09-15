import { useEventListener } from 'ahooks'
import { useWorkflowStore } from './store'
import { useWorkflowComment } from './hooks/use-workflow-comment'

const CommentManager = () => {
  const workflowStore = useWorkflowStore()
  const { handleCreateComment } = useWorkflowComment()

  useEventListener('click', (e) => {
    const { controlMode, mousePosition } = workflowStore.getState()

    if (controlMode === 'comment') {
      const target = e.target as HTMLElement
      const isInDropdown = target.closest('[data-mention-dropdown]')
      const isInCommentInput = target.closest('[data-comment-input]')

      if (!isInDropdown && !isInCommentInput) {
        e.preventDefault()
        handleCreateComment(mousePosition)
      }
    }
  })

  return null
}

export default CommentManager
