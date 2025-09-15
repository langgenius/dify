import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useStore } from '../store'
import { ControlMode } from '../types'
import type { WorkflowComment } from '@/service/workflow-comment'
import { createWorkflowComment, fetchWorkflowComments } from '@/service/workflow-comment'

export const useWorkflowComment = () => {
  const params = useParams()
  const appId = params.appId as string
  const controlMode = useStore(s => s.controlMode)
  const setControlMode = useStore(s => s.setControlMode)
  const pendingComment = useStore(s => s.pendingComment)
  const setPendingComment = useStore(s => s.setPendingComment)
  const [comments, setComments] = useState<WorkflowComment[]>([])
  const [loading, setLoading] = useState(false)

  // 加载评论列表
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

  // 初始化时加载评论
  useEffect(() => {
    loadComments()
  }, [loadComments])

  const handleCommentSubmit = useCallback(async (content: string) => {
    if (!pendingComment) return

    console.log('Submitting comment:', { appId, pendingComment, content })

    if (!appId) {
      console.error('AppId is missing')
      return
    }

    try {
      const newComment = await createWorkflowComment(appId, {
        position_x: pendingComment.x,
        position_y: pendingComment.y,
        content,
        mentioned_user_ids: [],
      })

      console.log('Comment created successfully:', newComment)
      setComments(prev => [...prev, newComment])
      setPendingComment(null)
      setControlMode(ControlMode.Pointer)
    }
 catch (error) {
      console.error('Failed to create comment:', error)
      setPendingComment(null)
      setControlMode(ControlMode.Pointer)
    }
  }, [appId, pendingComment, setControlMode, setPendingComment, setComments])

  const handleCommentCancel = useCallback(() => {
    setPendingComment(null)
    setControlMode(ControlMode.Pointer)
  }, [setControlMode, setPendingComment])

  const handleCommentIconClick = useCallback((comment: WorkflowComment) => {
    // TODO: display comment details
    console.log('Comment clicked:', comment)
  }, [])

  const handleCreateComment = useCallback((mousePosition: { pageX: number; pageY: number }) => {
    if (controlMode === ControlMode.Comment) {
      const containerElement = document.querySelector('#workflow-container')
      if (containerElement) {
        const containerBounds = containerElement.getBoundingClientRect()
        const position = {
          x: mousePosition.pageX - containerBounds.left,
          y: mousePosition.pageY - containerBounds.top,
        }
        console.log('Setting pending comment at position:', position)
        setPendingComment(position)
      }
 else {
        console.error('Could not find workflow container element')
      }
    }
 else {
      console.log('Control mode is not Comment:', controlMode)
    }
  }, [controlMode, setPendingComment])

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
