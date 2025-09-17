import { useCallback, useEffect, useRef } from 'react'
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
  const comments = useStore(s => s.comments)
  const setComments = useStore(s => s.setComments)
  const loading = useStore(s => s.commentsLoading)
  const setCommentsLoading = useStore(s => s.setCommentsLoading)
  const activeComment = useStore(s => s.activeCommentDetail)
  const setActiveComment = useStore(s => s.setActiveCommentDetail)
  const activeCommentLoading = useStore(s => s.activeCommentDetailLoading)
  const setActiveCommentLoading = useStore(s => s.setActiveCommentDetailLoading)
  const commentDetailCache = useStore(s => s.commentDetailCache)
  const setCommentDetailCache = useStore(s => s.setCommentDetailCache)
  const commentDetailCacheRef = useRef<Record<string, WorkflowCommentDetail>>(commentDetailCache)
  const activeCommentIdRef = useRef<string | null>(null)

  useEffect(() => {
    activeCommentIdRef.current = activeCommentId ?? null
  }, [activeCommentId])

  useEffect(() => {
    commentDetailCacheRef.current = commentDetailCache
  }, [commentDetailCache])

  const loadComments = useCallback(async () => {
    if (!appId) return

    setCommentsLoading(true)
    try {
      const commentsData = await fetchWorkflowComments(appId)
      setComments(commentsData)
    }
    catch (error) {
      console.error('Failed to fetch comments:', error)
    }
    finally {
      setCommentsLoading(false)
    }
  }, [appId, setComments, setCommentsLoading])

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
    const fallbackDetail = cachedDetail ?? comment
    setActiveComment(fallbackDetail)

    reactflow.setCenter(comment.position_x, comment.position_y, { zoom: 1, duration: 600 })

    if (!appId) return

    setActiveCommentLoading(!cachedDetail)

    try {
      const detailResponse = await fetchWorkflowComment(appId, comment.id)
      const detail = (detailResponse as any)?.data ?? detailResponse

      commentDetailCacheRef.current = {
        ...commentDetailCacheRef.current,
        [comment.id]: detail,
      }
      setCommentDetailCache(commentDetailCacheRef.current)

      if (activeCommentIdRef.current === comment.id)
        setActiveComment(detail)
    }
    catch (e) {
      console.warn('Failed to load workflow comment detail', e)
    }
    finally {
      setActiveCommentLoading(false)
    }
  }, [appId, reactflow, setActiveComment, setActiveCommentId, setActiveCommentLoading, setCommentDetailCache, setControlMode, setPendingComment])

  const handleActiveCommentClose = useCallback(() => {
    setActiveComment(null)
    setActiveCommentLoading(false)
    setActiveCommentId(null)
    setControlMode(ControlMode.Pointer)
    activeCommentIdRef.current = null
  }, [setActiveComment, setActiveCommentId, setActiveCommentLoading, setControlMode])

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
