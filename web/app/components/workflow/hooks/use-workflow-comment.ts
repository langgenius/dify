import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useReactFlow } from 'reactflow'
import { useStore } from '../store'
import { ControlMode } from '../types'
import type { WorkflowCommentList } from '@/service/workflow-comment'
import { createWorkflowComment, fetchWorkflowComments } from '@/service/workflow-comment'

export const useWorkflowComment = () => {
  const params = useParams()
  const appId = params.appId as string
  const reactflow = useReactFlow()
  const controlMode = useStore(s => s.controlMode)
  const setControlMode = useStore(s => s.setControlMode)
  const pendingComment = useStore(s => s.pendingComment)
  const setPendingComment = useStore(s => s.setPendingComment)
  const [comments, setComments] = useState<WorkflowCommentList[]>([])
  const [loading, setLoading] = useState(false)

  const loadComments = useCallback(async () => {
    if (!appId) return

    setLoading(true)
    try {
      const commentsData = await fetchWorkflowComments(appId)
      setComments(commentsData)
    }
 catch (error) {
      console.error('Failed to fetch comments:', error)
    }
 finally {
      setLoading(false)
    }
  }, [appId])

  useEffect(() => {
    loadComments()
  }, [loadComments])

  const handleCommentSubmit = useCallback(async (content: string, mentionedUserIds: string[] = []) => {
    if (!pendingComment) return

    console.log('Submitting comment:', { appId, pendingComment, content, mentionedUserIds })

    if (!appId) {
      console.error('AppId is missing')
      return
    }

    try {
      const newComment = await createWorkflowComment(appId, {
        position_x: pendingComment.x,
        position_y: pendingComment.y,
        content,
        mentioned_user_ids: mentionedUserIds,
      })

      console.log('Comment created successfully:', newComment)
      await loadComments()
      setPendingComment(null)
      setControlMode(ControlMode.Pointer)
    }
    catch (error) {
      console.error('Failed to create comment:', error)
      setPendingComment(null)
      setControlMode(ControlMode.Pointer)
    }
  }, [appId, pendingComment, setControlMode, setPendingComment, loadComments])

  const handleCommentCancel = useCallback(() => {
    setPendingComment(null)
    setControlMode(ControlMode.Pointer)
  }, [setControlMode, setPendingComment])

  const handleCommentIconClick = useCallback((comment: WorkflowCommentList) => {
    // TODO: display comment details
    console.log('Comment clicked:', comment)
  }, [])

  const handleCreateComment = useCallback((mousePosition: { pageX: number; pageY: number }) => {
    if (controlMode === ControlMode.Comment) {
      const { screenToFlowPosition } = reactflow
      const flowPosition = screenToFlowPosition({ x: mousePosition.pageX, y: mousePosition.pageY })

      console.log('Setting pending comment at flow position:', flowPosition)
      setPendingComment(flowPosition)
    }
    else {
      console.log('Control mode is not Comment:', controlMode)
    }
  }, [controlMode, setPendingComment, reactflow])

  return {
    comments,
    loading,
    pendingComment,
    handleCommentSubmit,
    handleCommentCancel,
    handleCommentIconClick,
    handleCreateComment,
    loadComments,
  }
}
