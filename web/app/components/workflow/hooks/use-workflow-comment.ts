import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { useReactFlow } from 'reactflow'
import { useStore } from '../store'
import { ControlMode } from '../types'
import type { WorkflowCommentDetail, WorkflowCommentList } from '@/service/workflow-comment'
import { createWorkflowComment, fetchWorkflowComment, fetchWorkflowComments } from '@/service/workflow-comment'

export const useWorkflowComment = () => {
  const params = useParams()
  const appId = params.appId as string
  const reactflow = useReactFlow()
  const controlMode = useStore(s => s.controlMode)
  const setControlMode = useStore(s => s.setControlMode)
  const pendingComment = useStore(s => s.pendingComment)
  const setPendingComment = useStore(s => s.setPendingComment)
  const setActiveCommentId = useStore(s => s.setActiveCommentId)
  const activeCommentId = useStore(s => s.activeCommentId)
  const [comments, setComments] = useState<WorkflowCommentList[]>([])
  const [loading, setLoading] = useState(false)
  const [activeComment, setActiveComment] = useState<WorkflowCommentDetail | null>(null)
  const [activeCommentLoading, setActiveCommentLoading] = useState(false)
  const commentDetailCacheRef = useRef<Record<string, WorkflowCommentDetail>>({})
  const activeCommentIdRef = useRef<string | null>(null)
  useEffect(() => {
    activeCommentIdRef.current = activeCommentId ?? null
  }, [activeCommentId])

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

  const handleCommentIconClick = useCallback(async (comment: WorkflowCommentList) => {
    setPendingComment(null)

    activeCommentIdRef.current = comment.id
    setControlMode(ControlMode.Comment)
    setActiveCommentId(comment.id)

    const cachedDetail = commentDetailCacheRef.current[comment.id]
    setActiveComment(cachedDetail || comment)

    reactflow.setCenter(comment.position_x, comment.position_y, { zoom: 1, duration: 600 })

    if (!appId) return

    if (!cachedDetail)
      setActiveCommentLoading(true)

    try {
      const detailResponse = await fetchWorkflowComment(appId, comment.id)
      const detail = (detailResponse as any)?.data ?? detailResponse

      commentDetailCacheRef.current = {
        ...commentDetailCacheRef.current,
        [comment.id]: detail,
      }

      if (activeCommentIdRef.current === comment.id)
        setActiveComment(detail)
    }
    catch (e) {
      console.warn('Failed to load workflow comment detail', e)
    }
    finally {
      setActiveCommentLoading(false)
    }
  }, [appId, reactflow, setPendingComment])

  const handleActiveCommentClose = useCallback(() => {
    setActiveComment(null)
    setActiveCommentLoading(false)
    setActiveCommentId(null)
    setControlMode(ControlMode.Pointer)
    activeCommentIdRef.current = null
  }, [setActiveCommentId, setControlMode])

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
    activeComment,
    activeCommentLoading,
    handleCommentSubmit,
    handleCommentCancel,
    handleCommentIconClick,
    handleActiveCommentClose,
    handleCreateComment,
    loadComments,
  }
}
