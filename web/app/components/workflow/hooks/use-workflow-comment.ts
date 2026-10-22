import type {
  WorkflowCommentBasic,
  WorkflowCommentDetail,
} from '@dify/contracts/api/console/apps/types.gen'
import type { UserProfile } from '@/app/components/workflow/comment/types'
import {
  isCancelledError,
  useIsMutating,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useReactFlow } from 'reactflow'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { editorAppIdAtom } from '@/app/components/workflow/editor-resource/state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { collaborationEnabledAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { commentsAtom, commentsLoadingAtom, createCommentDetailAtoms } from '../comment/state'
import { useStore } from '../store'
import { ControlMode } from '../types'

const EMPTY_USERS: UserProfile[] = []

const normalizeTimestamp = (value: number | string | null | undefined): number => {
  if (value == null) return Math.floor(Date.now() / 1000)

  if (typeof value === 'number') return value

  const parsed = Number(value)
  if (!Number.isNaN(parsed)) return parsed

  return Math.floor(Date.parse(value) / 1000)
}

const matchesCommentMutation = (
  variables: unknown,
  appId: string | undefined,
  commentId?: string | null,
) => {
  if (!appId || !variables || typeof variables !== 'object' || !('params' in variables))
    return false
  const params = variables.params
  if (!params || typeof params !== 'object' || !('app_id' in params)) return false
  return (
    params.app_id === appId &&
    (commentId === undefined || ('comment_id' in params && params.comment_id === commentId))
  )
}

export const useWorkflowComment = () => {
  const appId = useAtomValue(editorAppIdAtom)
  const reactflow = useReactFlow()
  const controlMode = useStore((s) => s.controlMode)
  const pendingComment = useStore((s) => s.pendingComment)
  const setPendingComment = useStore((s) => s.setPendingComment)
  const isCommentQuickAdd = useStore((s) => s.isCommentQuickAdd)
  const setCommentQuickAdd = useStore((s) => s.setCommentQuickAdd)
  const isCommentPlacing = useStore((s) => s.isCommentPlacing)
  const setActiveCommentId = useStore((s) => s.setActiveCommentId)
  const activeCommentId = useStore((s) => s.activeCommentId)
  const queryClient = useQueryClient()
  const comments = useAtomValue(commentsAtom)
  const loading = useAtomValue(commentsLoadingAtom)
  const detailAtoms = useMemo(() => createCommentDetailAtoms(activeCommentId), [activeCommentId])
  const detail = useAtomValue(detailAtoms.data)
  const detailLoading = useAtomValue(detailAtoms.loading)
  const selectedComment = comments.find((comment) => comment.id === activeCommentId)
  const activeComment = activeCommentId
    ? (detail ?? (selectedComment ? { ...selectedComment, replies: [], mentions: [] } : null))
    : null
  const { mutateAsync: createComment } = useMutation(
    consoleQuery.apps.byAppId.workflow.comments.post.mutationOptions(),
  )
  const { mutateAsync: updateComment } = useMutation(
    consoleQuery.apps.byAppId.workflow.comments.byCommentId.put.mutationOptions(),
  )
  const { mutateAsync: deleteComment } = useMutation(
    consoleQuery.apps.byAppId.workflow.comments.byCommentId.delete.mutationOptions(),
  )
  const { mutateAsync: resolveComment } = useMutation(
    consoleQuery.apps.byAppId.workflow.comments.byCommentId.resolve.post.mutationOptions(),
  )
  const { mutateAsync: createReply } = useMutation(
    consoleQuery.apps.byAppId.workflow.comments.byCommentId.replies.post.mutationOptions(),
  )
  const { mutateAsync: updateReply } = useMutation(
    consoleQuery.apps.byAppId.workflow.comments.byCommentId.replies.byReplyId.put.mutationOptions(),
  )
  const { mutateAsync: deleteReply } = useMutation(
    consoleQuery.apps.byAppId.workflow.comments.byCommentId.replies.byReplyId.delete.mutationOptions(),
  )
  const replySubmitting =
    useIsMutating({
      mutationKey:
        consoleQuery.apps.byAppId.workflow.comments.byCommentId.replies.post.mutationKey(),
      predicate: ({ state }) => matchesCommentMutation(state.variables, appId),
    }) > 0
  const replyUpdating =
    useIsMutating({
      mutationKey:
        consoleQuery.apps.byAppId.workflow.comments.byCommentId.replies.byReplyId.put.mutationKey(),
      predicate: ({ state }) => matchesCommentMutation(state.variables, appId),
    }) > 0
  const resolving = useIsMutating({
    mutationKey: consoleQuery.apps.byAppId.workflow.comments.byCommentId.resolve.post.mutationKey(),
    predicate: ({ state }) =>
      !!activeCommentId && matchesCommentMutation(state.variables, appId, activeCommentId),
  })
  const deleting = useIsMutating({
    mutationKey: consoleQuery.apps.byAppId.workflow.comments.byCommentId.delete.mutationKey(),
    predicate: ({ state }) =>
      !!activeCommentId && matchesCommentMutation(state.variables, appId, activeCommentId),
  })
  const deletingReply = useIsMutating({
    mutationKey:
      consoleQuery.apps.byAppId.workflow.comments.byCommentId.replies.byReplyId.delete.mutationKey(),
    predicate: ({ state }) =>
      !!activeCommentId && matchesCommentMutation(state.variables, appId, activeCommentId),
  })
  const activeCommentLoading = detailLoading || resolving > 0 || deleting > 0 || deletingReply > 0
  const rightPanelWidth = useStore((s) => s.rightPanelWidth)
  const nodePanelWidth = useStore((s) => s.nodePanelWidth)
  const mentionableUsers = useStore((state) =>
    appId ? (state.mentionableUsersCache[appId] ?? EMPTY_USERS) : EMPTY_USERS,
  )
  const mentionableUserById = useMemo(
    () => new Map(mentionableUsers.map((user) => [user.id, user])),
    [mentionableUsers],
  )
  const { data: userProfile } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile,
  })
  const isCollaborationEnabled = useAtomValue(collaborationEnabledAtom)
  const activeCommentIdRef = useRef<string | null>(null)
  const commentFocusToRestoreRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    const commentId = commentFocusToRestoreRef.current
    commentFocusToRestoreRef.current = null
    if (!commentId || activeCommentId) return

    // Closing rebuilds the marker, so resolve its identity after the DOM commit.
    document.getElementById(`workflow-comment-marker-${commentId}`)?.focus({ preventScroll: true })
  }, [activeCommentId])

  useEffect(() => {
    activeCommentIdRef.current = activeCommentId ?? null
  }, [activeCommentId])

  const refreshActiveComment = useCallback(
    async (commentId: string) => {
      if (!appId || !isCollaborationEnabled) return
      await queryClient.query(
        consoleQuery.apps.byAppId.workflow.comments.byCommentId.get.queryOptions({
          input: { params: { app_id: appId, comment_id: commentId } },
          staleTime: 0,
        }),
      )
    },
    [appId, isCollaborationEnabled, queryClient],
  )

  const loadComments = useCallback(async () => {
    if (!appId || !isCollaborationEnabled) return
    try {
      await queryClient.query(
        consoleQuery.apps.byAppId.workflow.comments.get.queryOptions({
          input: { params: { app_id: appId } },
          staleTime: 0,
        }),
      )
    } catch (error) {
      console.error('Failed to fetch comments:', error)
    }
  }, [appId, isCollaborationEnabled, queryClient])

  useEffect(() => {
    if (!appId || !isCollaborationEnabled) return
    return collaborationManager.onCommentsUpdate((update) => {
      if (update.appId !== appId) return
      void queryClient
        .invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.workflow.comments.key({
            input: { params: { app_id: appId } },
          }),
        })
        .catch((error) => console.error('Failed to refresh comments:', error))
    })
  }, [appId, isCollaborationEnabled, queryClient])

  const handleCommentSubmit = useCallback(
    async (content: string, mentionedUserIds: string[] = []) => {
      if (!pendingComment) return

      if (!appId) {
        console.error('AppId is missing')
        return
      }

      try {
        // Convert screen position to flow position when submitting
        const { screenToFlowPosition } = reactflow
        const flowPosition = screenToFlowPosition({
          x: pendingComment.pageX,
          y: pendingComment.pageY,
        })

        const newComment = await createComment({
          params: { app_id: appId },
          body: {
            position_x: flowPosition.x,
            position_y: flowPosition.y,
            content,
            mentioned_user_ids: mentionedUserIds,
          },
        })

        const createdAtSeconds = normalizeTimestamp(newComment.created_at)
        const createdByAccount = {
          id: userProfile?.id ?? '',
          name: userProfile?.name ?? '',
          email: userProfile?.email ?? '',
          avatar_url: userProfile?.avatar_url || userProfile?.avatar || null,
        }
        const mentionedUsers = mentionedUserIds
          .map((mentionedId) => mentionableUserById.get(mentionedId))
          .filter((user): user is NonNullable<typeof user> => Boolean(user))
        const uniqueParticipantsMap = new Map<string, typeof createdByAccount>()
        if (createdByAccount.id) uniqueParticipantsMap.set(createdByAccount.id, createdByAccount)
        for (const user of mentionedUsers) {
          if (!uniqueParticipantsMap.has(user.id)) {
            uniqueParticipantsMap.set(user.id, {
              id: user.id,
              name: user.name,
              email: user.email,
              avatar_url: user.avatar_url ?? null,
            })
          }
        }
        const participants = Array.from(uniqueParticipantsMap.values())

        const composedComment: WorkflowCommentBasic = {
          id: newComment.id,
          position_x: flowPosition.x,
          position_y: flowPosition.y,
          content,
          created_by: createdByAccount.id,
          created_by_account: createdByAccount,
          created_at: createdAtSeconds,
          updated_at: createdAtSeconds,
          resolved: false,
          mention_count: mentionedUserIds.length,
          reply_count: 0,
          participants,
        }

        const composedDetail: WorkflowCommentDetail = {
          id: newComment.id,
          position_x: flowPosition.x,
          position_y: flowPosition.y,
          content,
          created_by: createdByAccount.id,
          created_by_account: createdByAccount,
          created_at: createdAtSeconds,
          updated_at: createdAtSeconds,
          resolved: false,
          replies: [],
          mentions: mentionedUserIds.map((mentionedId) => ({
            mentioned_user_id: mentionedId,
            mentioned_user_account: mentionableUserById.get(mentionedId) ?? null,
            reply_id: null,
          })),
        }

        queryClient.setQueryData(
          consoleQuery.apps.byAppId.workflow.comments.get.queryKey({
            input: { params: { app_id: appId } },
          }),
          (list) =>
            list?.data.some((comment) => comment.id === newComment.id)
              ? list
              : { data: [...(list?.data ?? []), composedComment] },
        )
        queryClient.setQueryData(
          consoleQuery.apps.byAppId.workflow.comments.byCommentId.get.queryKey({
            input: { params: { app_id: appId, comment_id: newComment.id } },
          }),
          (cached) => cached ?? composedDetail,
        )

        collaborationManager.emitCommentsUpdate(appId)

        setPendingComment(null)
        setCommentQuickAdd(false)
      } catch (error) {
        console.error('Failed to create comment:', error)
        setPendingComment(null)
        setCommentQuickAdd(false)
      }
    },
    [
      appId,
      pendingComment,
      setPendingComment,
      setCommentQuickAdd,
      reactflow,
      createComment,
      queryClient,
      userProfile,
      mentionableUserById,
    ],
  )

  const handleCommentCancel = useCallback(() => {
    setPendingComment(null)
    setCommentQuickAdd(false)
  }, [setPendingComment, setCommentQuickAdd])

  useEffect(() => {
    if (controlMode !== ControlMode.Comment && !isCommentQuickAdd) setPendingComment(null)
  }, [controlMode, isCommentQuickAdd, setPendingComment])

  useEffect(() => {
    if (!pendingComment && !isCommentPlacing && isCommentQuickAdd) setCommentQuickAdd(false)
  }, [isCommentPlacing, isCommentQuickAdd, pendingComment, setCommentQuickAdd])

  const handleCommentIconClick = useCallback(
    async (comment: WorkflowCommentBasic) => {
      commentFocusToRestoreRef.current = null
      setPendingComment(null)

      activeCommentIdRef.current = comment.id
      setActiveCommentId(comment.id)

      const hasSelectedNode = reactflow.getNodes().some((node) => node.data?.selected)
      const commentPanelWidth = controlMode === ControlMode.Comment ? 420 : 0
      const fallbackPanelWidth = (hasSelectedNode ? nodePanelWidth : 0) + commentPanelWidth
      const effectivePanelWidth = Math.max(rightPanelWidth ?? 0, fallbackPanelWidth)

      const baseHorizontalOffsetPx = 220
      const panelCompensationPx = effectivePanelWidth / 2
      const desiredHorizontalOffsetPx = baseHorizontalOffsetPx + panelCompensationPx
      const maxOffset = Math.max(0, window.innerWidth / 2 - 60)
      const horizontalOffsetPx = Math.min(desiredHorizontalOffsetPx, maxOffset)

      reactflow.setCenter(comment.position_x + horizontalOffsetPx, comment.position_y, {
        zoom: 1,
        duration: 600,
      })

      if (!appId) return

      try {
        await refreshActiveComment(comment.id)
      } catch (error) {
        if (!isCancelledError(error)) console.warn('Failed to load workflow comment detail', error)
      }
    },
    [
      appId,
      controlMode,
      nodePanelWidth,
      reactflow,
      rightPanelWidth,
      setActiveCommentId,
      setPendingComment,
      refreshActiveComment,
    ],
  )

  const handleCommentResolve = useCallback(
    async (commentId: string) => {
      if (!appId) return
      try {
        await resolveComment({ params: { app_id: appId, comment_id: commentId } })
        collaborationManager.emitCommentsUpdate(appId)
      } catch (error) {
        console.error('Failed to resolve comment:', error)
      }
    },
    [appId, resolveComment],
  )

  const handleCommentDelete = useCallback(
    async (commentId: string) => {
      if (!appId) return
      const commentIndex = comments.findIndex((comment) => comment.id === commentId)
      try {
        await deleteComment({ params: { app_id: appId, comment_id: commentId } })
        collaborationManager.emitCommentsUpdate(appId)
        if (activeCommentIdRef.current !== commentId) return

        const remaining =
          queryClient.getQueryData(
            consoleQuery.apps.byAppId.workflow.comments.get.queryKey({
              input: { params: { app_id: appId } },
            }),
          )?.data ?? []
        const neighbor = comments[commentIndex + 1] ?? comments[commentIndex - 1]
        const target = remaining.find((comment) => comment.id === neighbor?.id) ?? remaining[0]
        if (target) await handleCommentIconClick(target)
        else {
          setActiveCommentId(null)
          activeCommentIdRef.current = null
        }
      } catch (error) {
        console.error('Failed to delete comment:', error)
      }
    },
    [appId, comments, deleteComment, handleCommentIconClick, queryClient, setActiveCommentId],
  )

  const handleCommentPositionUpdate = useCallback(
    async (commentId: string, position: { x: number; y: number }) => {
      if (!appId) return

      const targetComment = comments.find((c) => c.id === commentId)
      if (!targetComment) return

      const nextPosition = {
        position_x: position.x,
        position_y: position.y,
      }

      const listKey = consoleQuery.apps.byAppId.workflow.comments.get.queryKey({
        input: { params: { app_id: appId } },
      })
      const detailKey = consoleQuery.apps.byAppId.workflow.comments.byCommentId.get.queryKey({
        input: { params: { app_id: appId, comment_id: commentId } },
      })
      await Promise.all([
        queryClient.cancelQueries({ queryKey: listKey }),
        queryClient.cancelQueries({ queryKey: detailKey }),
      ])
      const previousDetail = queryClient.getQueryData(detailKey)
      queryClient.setQueryData(listKey, (list) =>
        list
          ? {
              ...list,
              data: list.data.map((comment) =>
                comment.id === commentId ? { ...comment, ...nextPosition } : comment,
              ),
            }
          : list,
      )
      queryClient.setQueryData(detailKey, (detail) =>
        detail ? { ...detail, ...nextPosition } : detail,
      )

      try {
        await updateComment({
          params: { app_id: appId, comment_id: commentId },
          body: { content: targetComment.content, ...nextPosition },
        })
        collaborationManager.emitCommentsUpdate(appId)
      } catch (error) {
        console.error('Failed to update comment position:', error)
        // A late failure must not undo a newer move or another user's edits.
        queryClient.setQueryData(listKey, (list) =>
          list
            ? {
                ...list,
                data: list.data.map((comment) =>
                  comment.id === commentId &&
                  comment.position_x === position.x &&
                  comment.position_y === position.y
                    ? {
                        ...comment,
                        position_x: targetComment.position_x,
                        position_y: targetComment.position_y,
                      }
                    : comment,
                ),
              }
            : list,
        )
        queryClient.setQueryData(detailKey, (detail) =>
          detail &&
          previousDetail &&
          detail.position_x === position.x &&
          detail.position_y === position.y
            ? {
                ...detail,
                position_x: previousDetail.position_x,
                position_y: previousDetail.position_y,
              }
            : detail,
        )
      }
    },
    [appId, comments, queryClient, updateComment],
  )

  const handleCommentUpdate = useCallback(
    async (commentId: string, content: string, mentionedUserIds: string[] = []) => {
      if (!appId) return
      const trimmed = content.trim()
      if (!trimmed) return

      const targetComment = comments.find((c) => c.id === commentId)
      const targetDetail = queryClient.getQueryData(
        consoleQuery.apps.byAppId.workflow.comments.byCommentId.get.queryKey({
          input: { params: { app_id: appId, comment_id: commentId } },
        }),
      )
      const positionX = targetDetail?.position_x ?? targetComment?.position_x
      const positionY = targetDetail?.position_y ?? targetComment?.position_y

      if (positionX === undefined || positionY === undefined) return

      try {
        await updateComment({
          params: { app_id: appId, comment_id: commentId },
          body: {
            content: trimmed,
            position_x: positionX,
            position_y: positionY,
            mentioned_user_ids: mentionedUserIds,
          },
        })

        collaborationManager.emitCommentsUpdate(appId)
      } catch (error) {
        console.error('Failed to update comment:', error)
      }
    },
    [appId, comments, queryClient, updateComment],
  )

  const handleCommentReply = useCallback(
    async (commentId: string, content: string, mentionedUserIds: string[] = []) => {
      if (!appId) return
      const trimmed = content.trim()
      if (!trimmed) return

      try {
        await createReply({
          params: { app_id: appId, comment_id: commentId },
          body: { content: trimmed, mentioned_user_ids: mentionedUserIds },
        })

        collaborationManager.emitCommentsUpdate(appId)
      } catch (error) {
        console.error('Failed to create reply:', error)
      }
    },
    [appId, createReply],
  )

  const handleCommentReplyUpdate = useCallback(
    async (
      commentId: string,
      replyId: string,
      content: string,
      mentionedUserIds: string[] = [],
    ) => {
      if (!appId) return
      const trimmed = content.trim()
      if (!trimmed) return

      try {
        await updateReply({
          params: { app_id: appId, comment_id: commentId, reply_id: replyId },
          body: { content: trimmed, mentioned_user_ids: mentionedUserIds },
        })

        collaborationManager.emitCommentsUpdate(appId)
      } catch (error) {
        console.error('Failed to update reply:', error)
      }
    },
    [appId, updateReply],
  )

  const handleCommentReplyDelete = useCallback(
    async (commentId: string, replyId: string) => {
      if (!appId) return

      try {
        await deleteReply({
          params: { app_id: appId, comment_id: commentId, reply_id: replyId },
        })

        collaborationManager.emitCommentsUpdate(appId)
      } catch (error) {
        console.error('Failed to delete reply:', error)
      }
    },
    [appId, deleteReply],
  )

  const handleCommentNavigate = useCallback(
    (direction: 'prev' | 'next') => {
      const currentId = activeCommentIdRef.current
      if (!currentId) return
      const idx = comments.findIndex((c) => c.id === currentId)
      if (idx === -1) return
      const target = direction === 'prev' ? comments[idx - 1] : comments[idx + 1]
      if (target) handleCommentIconClick(target)
    },
    [comments, handleCommentIconClick],
  )

  const handleActiveCommentClose = useCallback(() => {
    commentFocusToRestoreRef.current = activeCommentIdRef.current
    setActiveCommentId(null)
    activeCommentIdRef.current = null
  }, [setActiveCommentId])

  const handleCreateComment = useCallback(
    (mousePosition: { pageX: number; pageY: number; elementX: number; elementY: number }) => {
      if (controlMode === ControlMode.Comment) setPendingComment(mousePosition)
    },
    [controlMode, setPendingComment],
  )

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
    handleCommentUpdate,
    handleCommentReply,
    handleCommentReplyUpdate,
    handleCommentReplyDelete,
    handleCommentPositionUpdate,
    refreshActiveComment,
    handleCreateComment,
    loadComments,
  }
}
