import { useCallback, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import { useReactFlow } from 'reactflow'
import { useStore } from '../store'
import { ControlMode } from '../types'
import type { WorkflowCommentDetail, WorkflowCommentList } from '@/service/workflow-comment'
import { createWorkflowComment, createWorkflowCommentReply, deleteWorkflowComment, deleteWorkflowCommentReply, fetchWorkflowComment, fetchWorkflowComments, resolveWorkflowComment, updateWorkflowCommentReply } from '@/service/workflow-comment'

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
    setActiveComment(cachedDetail || comment)

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

  const refreshActiveComment = useCallback(async (commentId: string) => {
    if (!appId) return

    const detailResponse = await fetchWorkflowComment(appId, commentId)
    const detail = (detailResponse as any)?.data ?? detailResponse

    commentDetailCacheRef.current = {
      ...commentDetailCacheRef.current,
      [commentId]: detail,
    }
    setCommentDetailCache(commentDetailCacheRef.current)
    setActiveComment(detail)
  }, [appId, setActiveComment, setCommentDetailCache])

  const handleCommentResolve = useCallback(async (commentId: string) => {
    if (!appId) return

    setActiveCommentLoading(true)
    try {
      await resolveWorkflowComment(appId, commentId)
      await refreshActiveComment(commentId)
      await loadComments()
    }
    catch (error) {
      console.error('Failed to resolve comment:', error)
    }
    finally {
      setActiveCommentLoading(false)
    }
  }, [appId, loadComments, refreshActiveComment, setActiveCommentLoading])

  const handleCommentDelete = useCallback(async (commentId: string) => {
    if (!appId) return

    setActiveCommentLoading(true)
    try {
      await deleteWorkflowComment(appId, commentId)
      const updatedCache = { ...commentDetailCacheRef.current }
      delete updatedCache[commentId]
      commentDetailCacheRef.current = updatedCache
      setCommentDetailCache(updatedCache)

      const currentComments = comments.filter(c => c.id !== commentId)
      const commentIndex = comments.findIndex(c => c.id === commentId)
      const fallbackTarget = commentIndex >= 0 ? comments[commentIndex + 1] ?? comments[commentIndex - 1] : undefined

      await loadComments()

      if (fallbackTarget) {
        handleCommentIconClick(fallbackTarget)
      }
      else if (currentComments.length > 0) {
        const nextComment = currentComments[0]
        handleCommentIconClick(nextComment)
      }
      else {
        setActiveComment(null)
        setActiveCommentId(null)
        activeCommentIdRef.current = null
      }
    }
    catch (error) {
      console.error('Failed to delete comment:', error)
    }
    finally {
      setActiveCommentLoading(false)
    }
  }, [appId, comments, handleCommentIconClick, loadComments, setActiveComment, setActiveCommentId, setActiveCommentLoading, setCommentDetailCache])

  const handleCommentReply = useCallback(async (commentId: string, content: string, mentionedUserIds: string[] = []) => {
    if (!appId) return
    const trimmed = content.trim()
    if (!trimmed) return

    setActiveCommentLoading(true)
    try {
      await createWorkflowCommentReply(appId, commentId, { content: trimmed, mentioned_user_ids: mentionedUserIds })
      await refreshActiveComment(commentId)
      await loadComments()
    }
    catch (error) {
      console.error('Failed to create reply:', error)
    }
    finally {
      setActiveCommentLoading(false)
    }
  }, [appId, loadComments, refreshActiveComment, setActiveCommentLoading])

  const handleCommentReplyUpdate = useCallback(async (commentId: string, replyId: string, content: string, mentionedUserIds: string[] = []) => {
    if (!appId) return
    const trimmed = content.trim()
    if (!trimmed) return

    setActiveCommentLoading(true)
    try {
      await updateWorkflowCommentReply(appId, commentId, replyId, { content: trimmed, mentioned_user_ids: mentionedUserIds })
      await refreshActiveComment(commentId)
      await loadComments()
    }
    catch (error) {
      console.error('Failed to update reply:', error)
    }
    finally {
      setActiveCommentLoading(false)
    }
  }, [appId, loadComments, refreshActiveComment, setActiveCommentLoading])

  const handleCommentReplyDelete = useCallback(async (commentId: string, replyId: string) => {
    if (!appId) return

    setActiveCommentLoading(true)
    try {
      await deleteWorkflowCommentReply(appId, commentId, replyId)
      await refreshActiveComment(commentId)
      await loadComments()
    }
    catch (error) {
      console.error('Failed to delete reply:', error)
    }
    finally {
      setActiveCommentLoading(false)
    }
  }, [appId, loadComments, refreshActiveComment, setActiveCommentLoading])

  const handleCommentNavigate = useCallback((direction: 'prev' | 'next') => {
    const currentId = activeCommentIdRef.current
    if (!currentId) return
    const idx = comments.findIndex(c => c.id === currentId)
    if (idx === -1) return
    const target = direction === 'prev' ? comments[idx - 1] : comments[idx + 1]
    if (target)
      handleCommentIconClick(target)
  }, [comments, handleCommentIconClick])

  const handleActiveCommentClose = useCallback(() => {
    setActiveComment(null)
    setActiveCommentLoading(false)
    setActiveCommentId(null)
    activeCommentIdRef.current = null
  }, [setActiveComment, setActiveCommentId, setActiveCommentLoading])

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
    handleCommentResolve,
    handleCommentDelete,
    handleCommentNavigate,
    handleCommentReply,
    handleCommentReplyUpdate,
    handleCommentReplyDelete,
    refreshActiveComment,
    handleCreateComment,
    loadComments,
  }
}
