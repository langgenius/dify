import { useCallback, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import { useReactFlow } from 'reactflow'
import { useStore } from '../store'
import { ControlMode } from '../types'
import type { WorkflowCommentDetail, WorkflowCommentList } from '@/service/workflow-comment'
import { createWorkflowComment, createWorkflowCommentReply, deleteWorkflowComment, deleteWorkflowCommentReply, fetchWorkflowComment, fetchWorkflowComments, resolveWorkflowComment, updateWorkflowComment, updateWorkflowCommentReply } from '@/service/workflow-comment'
import { collaborationManager } from '@/app/components/workflow/collaboration'
import { useAppContext } from '@/context/app-context'

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
  const replySubmitting = useStore(s => s.replySubmitting)
  const setReplySubmitting = useStore(s => s.setReplySubmitting)
  const replyUpdating = useStore(s => s.replyUpdating)
  const setReplyUpdating = useStore(s => s.setReplyUpdating)
  const commentDetailCache = useStore(s => s.commentDetailCache)
  const setCommentDetailCache = useStore(s => s.setCommentDetailCache)
  const { userProfile } = useAppContext()
  const commentDetailCacheRef = useRef<Record<string, WorkflowCommentDetail>>(commentDetailCache)
  const activeCommentIdRef = useRef<string | null>(null)

  useEffect(() => {
    activeCommentIdRef.current = activeCommentId ?? null
  }, [activeCommentId])

  useEffect(() => {
    commentDetailCacheRef.current = commentDetailCache
  }, [commentDetailCache])

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

  // Setup collaboration
  useEffect(() => {
    if (!appId) return

    const unsubscribe = collaborationManager.onCommentsUpdate(() => {
      loadComments()
      if (activeCommentIdRef.current)
        refreshActiveComment(activeCommentIdRef.current)
    })

    return unsubscribe
  }, [appId, loadComments, refreshActiveComment])

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
      // Convert screen position to flow position when submitting
      const { screenToFlowPosition } = reactflow
      const flowPosition = screenToFlowPosition({ x: pendingComment.x, y: pendingComment.y })

      const newComment = await createWorkflowComment(appId, {
        position_x: flowPosition.x,
        position_y: flowPosition.y,
        content,
        mentioned_user_ids: mentionedUserIds,
      })

      console.log('Comment created successfully:', newComment)

      const createdAt = (newComment as any)?.created_at
      const createdByAccount = {
        id: userProfile?.id ?? '',
        name: userProfile?.name ?? '',
        email: userProfile?.email ?? '',
        avatar_url: userProfile?.avatar_url || userProfile?.avatar || undefined,
      }

      const composedComment: WorkflowCommentList = {
        id: newComment.id,
        position_x: flowPosition.x,
        position_y: flowPosition.y,
        content,
        created_by: createdByAccount.id,
        created_by_account: createdByAccount,
        created_at: createdAt,
        updated_at: createdAt,
        resolved: false,
        mention_count: mentionedUserIds.length,
        reply_count: 0,
        participants: createdByAccount.id ? [createdByAccount] : [],
      }

      const composedDetail: WorkflowCommentDetail = {
        id: newComment.id,
        position_x: flowPosition.x,
        position_y: flowPosition.y,
        content,
        created_by: createdByAccount.id,
        created_by_account: createdByAccount,
        created_at: createdAt,
        updated_at: createdAt,
        resolved: false,
        replies: [],
        mentions: mentionedUserIds.map(mentionedId => ({
          mentioned_user_id: mentionedId,
          mentioned_user_account: null,
          reply_id: null,
        })),
      }

      setComments([...comments, composedComment])
      commentDetailCacheRef.current = {
        ...commentDetailCacheRef.current,
        [newComment.id]: composedDetail,
      }
      setCommentDetailCache(commentDetailCacheRef.current)

      collaborationManager.emitCommentsUpdate(appId)

      setPendingComment(null)
    }
    catch (error) {
      console.error('Failed to create comment:', error)
      setPendingComment(null)
    }
  }, [appId, pendingComment, setPendingComment, reactflow, comments, setComments, userProfile, setCommentDetailCache])

  const handleCommentCancel = useCallback(() => {
    setPendingComment(null)
  }, [setPendingComment])

  useEffect(() => {
    if (controlMode !== ControlMode.Comment)
      setPendingComment(null)
  }, [controlMode, setPendingComment])

  const handleCommentIconClick = useCallback(async (comment: WorkflowCommentList) => {
    setPendingComment(null)

    activeCommentIdRef.current = comment.id
    setActiveCommentId(comment.id)

    const cachedDetail = commentDetailCacheRef.current[comment.id]
    setActiveComment(cachedDetail || comment)

    let horizontalOffsetPx = 220
    const maxOffset = Math.max(0, (window.innerWidth / 2) - 60)
    horizontalOffsetPx = Math.min(horizontalOffsetPx, maxOffset)

    reactflow.setCenter(
      comment.position_x + horizontalOffsetPx,
      comment.position_y,
      { zoom: 1, duration: 600 },
    )

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

  const handleCommentResolve = useCallback(async (commentId: string) => {
    if (!appId) return

    setActiveCommentLoading(true)
    try {
      await resolveWorkflowComment(appId, commentId)

      collaborationManager.emitCommentsUpdate(appId)

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

      collaborationManager.emitCommentsUpdate(appId)

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

  const handleCommentPositionUpdate = useCallback(async (commentId: string, position: { x: number; y: number }) => {
    if (!appId) return

    const targetComment = comments.find(c => c.id === commentId)
    if (!targetComment) return

    const nextPosition = {
      position_x: position.x,
      position_y: position.y,
    }

    const previousComments = comments
    const updatedComments = comments.map(c =>
      c.id === commentId
        ? { ...c, ...nextPosition }
        : c,
    )
    setComments(updatedComments)

    const cachedDetail = commentDetailCacheRef.current[commentId]
    const updatedDetail = cachedDetail ? { ...cachedDetail, ...nextPosition } : null
    if (updatedDetail) {
      commentDetailCacheRef.current = {
        ...commentDetailCacheRef.current,
        [commentId]: updatedDetail,
      }
      setCommentDetailCache(commentDetailCacheRef.current)

      if (activeCommentIdRef.current === commentId)
        setActiveComment(updatedDetail)
    }
    else if (activeComment?.id === commentId) {
      setActiveComment({ ...activeComment, ...nextPosition })
    }

    try {
      await updateWorkflowComment(appId, commentId, {
        content: targetComment.content,
        position_x: nextPosition.position_x,
        position_y: nextPosition.position_y,
      })
      collaborationManager.emitCommentsUpdate(appId)
    }
    catch (error) {
      console.error('Failed to update comment position:', error)
      setComments(previousComments)

      if (cachedDetail) {
        commentDetailCacheRef.current = {
          ...commentDetailCacheRef.current,
          [commentId]: cachedDetail,
        }
        setCommentDetailCache(commentDetailCacheRef.current)

        if (activeCommentIdRef.current === commentId)
          setActiveComment(cachedDetail)
      }
      else if (activeComment?.id === commentId) {
        setActiveComment(activeComment)
      }
    }
  }, [activeComment, appId, comments, setComments, setCommentDetailCache, setActiveComment])

  const handleCommentReply = useCallback(async (commentId: string, content: string, mentionedUserIds: string[] = []) => {
    if (!appId) return
    const trimmed = content.trim()
    if (!trimmed) return

    setReplySubmitting(true)
    try {
      await createWorkflowCommentReply(appId, commentId, { content: trimmed, mentioned_user_ids: mentionedUserIds })

      collaborationManager.emitCommentsUpdate(appId)

      await refreshActiveComment(commentId)
      await loadComments()
    }
    catch (error) {
      console.error('Failed to create reply:', error)
    }
    finally {
      setReplySubmitting(false)
    }
  }, [appId, loadComments, refreshActiveComment, setReplySubmitting])

  const handleCommentReplyUpdate = useCallback(async (commentId: string, replyId: string, content: string, mentionedUserIds: string[] = []) => {
    if (!appId) return
    const trimmed = content.trim()
    if (!trimmed) return

    setReplyUpdating(true)
    try {
      await updateWorkflowCommentReply(appId, commentId, replyId, { content: trimmed, mentioned_user_ids: mentionedUserIds })

      collaborationManager.emitCommentsUpdate(appId)

      await refreshActiveComment(commentId)
      await loadComments()
    }
    catch (error) {
      console.error('Failed to update reply:', error)
    }
    finally {
      setReplyUpdating(false)
    }
  }, [appId, loadComments, refreshActiveComment, setReplyUpdating])

  const handleCommentReplyDelete = useCallback(async (commentId: string, replyId: string) => {
    if (!appId) return

    setActiveCommentLoading(true)
    try {
      await deleteWorkflowCommentReply(appId, commentId, replyId)

      collaborationManager.emitCommentsUpdate(appId)

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

  const handleCreateComment = useCallback((mousePosition: { elementX: number; elementY: number }) => {
    if (controlMode === ControlMode.Comment) {
      console.log('Setting pending comment at screen position:', mousePosition)
      setPendingComment({ x: mousePosition.elementX, y: mousePosition.elementY })
    }
    else {
      console.log('Control mode is not Comment:', controlMode)
    }
  }, [controlMode, setPendingComment])

  return {
    comments,
    loading,
    pendingComment,
    activeComment,
    activeCommentLoading,
    replySubmitting,
    replyUpdating,
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
    handleCommentPositionUpdate,
    refreshActiveComment,
    handleCreateComment,
    loadComments,
  }
}
