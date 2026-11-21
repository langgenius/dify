import { useEventListener } from 'ahooks'
import { useEffect } from 'react'
import { useStore, useWorkflowStore } from './store'
import { ControlMode } from './types'

const CommentManager = () => {
  const workflowStore = useWorkflowStore()
  const controlMode = useStore((s) => s.controlMode)
  const pendingComment = useStore((s) => s.pendingComment)
  const isCommentPlacing = useStore((s) => s.isCommentPlacing)
  const isCommentQuickAdd = useStore((s) => s.isCommentQuickAdd)

  // A draft comment belongs to comment mode (or a quick add) and ends with it.
  useEffect(() => {
    if (controlMode !== ControlMode.Comment && !isCommentQuickAdd)
      workflowStore.setState({ pendingComment: null })
  }, [controlMode, isCommentQuickAdd, workflowStore])

  useEffect(() => {
    if (!pendingComment && !isCommentPlacing && isCommentQuickAdd)
      workflowStore.setState({ isCommentQuickAdd: false })
  }, [isCommentPlacing, isCommentQuickAdd, pendingComment, workflowStore])

  useEventListener('click', (e) => {
    const { controlMode, mousePosition, pendingComment, isCommentPlacing } =
      workflowStore.getState()
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
          workflowStore.setState({ pendingComment: null, isCommentQuickAdd: false })
        else workflowStore.setState({ pendingComment: mousePosition })
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
