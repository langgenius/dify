import type {
  WorkflowCommentBasic,
  WorkflowCommentDetail,
} from '@dify/contracts/api/console/apps/types.gen'
import type { ThreadReply } from '../comment/pending-reply'
import type { UserProfile } from '@/app/components/workflow/comment/types'
import { useDirection } from '@langgenius/dify-ui/direction-provider'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useReactFlow, useStoreApi } from 'reactflow'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import {
  editorAppIdAtom,
  editorCollaborationEnabledAtom,
} from '@/app/components/workflow/editor-resource/state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleClient } from '@/service/console'
import { createLocalReplyId, mergeFetchedReplies } from '../comment/pending-reply'
import { useStore, useWorkflowStore } from '../store'
import { ControlMode } from '../types'

const EMPTY_USERS: UserProfile[] = []

const normalizeTimestamp = (value: number | string | null | undefined): number => {
  if (value == null) return Math.floor(Date.now() / 1000)

  if (typeof value === 'number') return value

  const parsed = Number(value)
  if (!Number.isNaN(parsed)) return parsed

  return Math.floor(Date.parse(value) / 1000)
}

// Every write to a comment's detail or to the list takes a new version, shared by every
// user of the same workflow store. A fetch only applies its result if nothing was written
// since it started, so a slow, older fetch never overwrites a newer write.
type CommentVersions = { details: Map<string, number>; list: number; resolving: Set<string> }
const commentVersionsByStore = new WeakMap<object, CommentVersions>()
const getCommentVersions = (store: object) => {
  let versions = commentVersionsByStore.get(store)
  if (!versions) {
    versions = { details: new Map(), list: 0, resolving: new Set() }
    commentVersionsByStore.set(store, versions)
  }
  return versions
}

const toCommentDetailPreview = (comment: WorkflowCommentBasic): WorkflowCommentDetail => ({
  ...comment,
  replies: [],
  mentions: [],
})

export const useWorkflowComment = () => {
  const appId = useAtomValue(editorAppIdAtom)
  const reactflow = useReactFlow()
  const flowStore = useStoreApi()
  const direction = useDirection()
  const workflowStore = useWorkflowStore()
  const controlMode = useStore((s) => s.controlMode)
  const pendingComment = useStore((s) => s.pendingComment)
  const setPendingComment = useStore((s) => s.setPendingComment)
  const isCommentQuickAdd = useStore((s) => s.isCommentQuickAdd)
  const setCommentQuickAdd = useStore((s) => s.setCommentQuickAdd)
  const isCommentPlacing = useStore((s) => s.isCommentPlacing)
  const setActiveCommentId = useStore((s) => s.setActiveCommentId)
  const activeCommentId = useStore((s) => s.activeCommentId)
  const comments = useStore((s) => s.comments)
  const setComments = useStore((s) => s.setComments)
  const loading = useStore((s) => s.commentsLoading)
  const setCommentsLoading = useStore((s) => s.setCommentsLoading)
  const activeComment = useStore((s) => s.activeCommentDetail)
  const setActiveComment = useStore((s) => s.setActiveCommentDetail)
  const activeCommentLoading = useStore((s) => s.activeCommentDetailLoading)
  const setActiveCommentLoading = useStore((s) => s.setActiveCommentDetailLoading)
  const replyUpdating = useStore((s) => s.replyUpdating)
  const setReplyUpdating = useStore((s) => s.setReplyUpdating)
  const setCommentDetailCache = useStore((s) => s.setCommentDetailCache)
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
  const isCollaborationEnabled = useAtomValue(editorCollaborationEnabledAtom)
  const activeCommentIdRef = useRef<string | null>(null)
  const versions = getCommentVersions(workflowStore)

  useEffect(() => {
    activeCommentIdRef.current = activeCommentId ?? null
  }, [activeCommentId])

  const nextDetailVersion = useCallback(
    (commentId: string) => {
      const version = (versions.details.get(commentId) ?? 0) + 1
      versions.details.set(commentId, version)
      return version
    },
    [versions],
  )

  const fetchCommentDetail = useCallback(
    async (commentId: string) => {
      if (!appId) return
      const version = nextDetailVersion(commentId)

      const detail = await consoleClient.apps.byAppId.workflow.comments.byCommentId.get({
        params: { app_id: appId, comment_id: commentId },
      })
      if (versions.details.get(commentId) !== version) return

      const current = workflowStore.getState().commentDetailCache[commentId]
      const merged = current
        ? { ...detail, replies: mergeFetchedReplies(current.replies, detail.replies) }
        : detail
      // A resolve still on its way keeps showing as resolved.
      const next = versions.resolving.has(commentId) ? { ...merged, resolved: true } : merged
      setCommentDetailCache({ ...workflowStore.getState().commentDetailCache, [commentId]: next })
      // Only apply the fetched detail if this comment is still the active one;
      // otherwise a refresh for another comment can clobber the current selection.
      if (activeCommentIdRef.current === commentId) setActiveComment(next)
    },
    [appId, nextDetailVersion, setActiveComment, setCommentDetailCache, versions, workflowStore],
  )

  const refreshActiveComment = fetchCommentDetail

  const loadComments = useCallback(async () => {
    if (!appId || !isCollaborationEnabled) return

    const version = ++versions.list
    setCommentsLoading(true)
    try {
      const response = await consoleClient.apps.byAppId.workflow.comments.get({
        params: { app_id: appId },
      })
      if (versions.list === version) setComments(response.data)
    } catch (error) {
      console.error('Failed to fetch comments:', error)
    } finally {
      setCommentsLoading(false)
    }
  }, [appId, isCollaborationEnabled, setComments, setCommentsLoading, versions])

  // Write a mutation's result into the cached detail right away, so the thread updates
  // as soon as the request succeeds instead of after the refetches.
  // Unless told otherwise, a write invalidates fetches already running for the comment.
  const patchCommentDetail = useCallback(
    (
      commentId: string,
      update: (detail: WorkflowCommentDetail) => WorkflowCommentDetail,
      { invalidate = true }: { invalidate?: boolean } = {},
    ) => {
      // A thread whose first load is still running has only its preview to build on.
      const state = workflowStore.getState()
      const detail =
        state.commentDetailCache[commentId] ??
        (state.activeCommentId === commentId ? state.activeCommentDetail : null)
      if (!detail) return
      if (invalidate) nextDetailVersion(commentId)
      const next = update(detail)
      setCommentDetailCache({ ...workflowStore.getState().commentDetailCache, [commentId]: next })
      if (activeCommentIdRef.current === commentId) setActiveComment(next)
    },
    [nextDetailVersion, setActiveComment, setCommentDetailCache, workflowStore],
  )

  // Reconcile with the server in the background; nothing waits on it.
  const syncComment = useCallback(
    (commentId: string) => {
      Promise.all([refreshActiveComment(commentId), loadComments()]).catch((error) => {
        console.error('Failed to refresh comments:', error)
      })
    },
    [loadComments, refreshActiveComment],
  )

  // Setup collaboration
  useEffect(() => {
    if (!appId || !isCollaborationEnabled) return

    const unsubscribe = collaborationManager.onCommentsUpdate(() => {
      loadComments()
      if (activeCommentIdRef.current) refreshActiveComment(activeCommentIdRef.current)
    })

    return unsubscribe
  }, [appId, isCollaborationEnabled, loadComments, refreshActiveComment])

  useEffect(() => {
    loadComments()
  }, [loadComments])

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

        const newComment = await consoleClient.apps.byAppId.workflow.comments.post({
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

        versions.list += 1
        setComments([...workflowStore.getState().comments, composedComment])
        setCommentDetailCache({
          ...workflowStore.getState().commentDetailCache,
          [newComment.id]: composedDetail,
        })

        collaborationManager.emitCommentsUpdate(appId)
        // The local write dropped any list fetch already running; fetch it again.
        loadComments()

        setPendingComment(null)
        setCommentQuickAdd(false)
      } catch (error) {
        // The composer stays open with its text so it can be sent again.
        console.error('Failed to create comment:', error)
      }
    },
    [
      appId,
      pendingComment,
      setPendingComment,
      setCommentQuickAdd,
      reactflow,
      setComments,
      workflowStore,
      loadComments,
      versions,
      userProfile,
      setCommentDetailCache,
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

  // Brings a comment the user may not be looking at into view (thread navigation and the
  // comments panel). It moves the canvas only when the
  // marker is outside the area the side panels leave visible, and at once: this navigation
  // is frequent and often keyboard-driven, and the open thread just moves to its new marker.
  const revealComment = useCallback(
    (comment: WorkflowCommentBasic) => {
      const { width, height } = flowStore.getState()
      if (!width || !height) return
      // The side panels sit at the inline end: on the right, or on the left in RTL.
      const panelWidth = workflowStore.getState().rightPanelWidth ?? 0
      const visibleStart = direction === 'rtl' ? panelWidth : 0
      const visibleEnd = direction === 'rtl' ? width : width - panelWidth
      const { x, y, zoom } = reactflow.getViewport()
      const markerX = comment.position_x * zoom + x
      const markerY = comment.position_y * zoom + y
      const inView =
        markerX >= visibleStart + 40 &&
        markerX <= visibleEnd - 40 &&
        markerY >= 40 &&
        markerY <= height - 40
      if (inView) return
      reactflow.setViewport({
        x: (visibleStart + visibleEnd) / 2 - comment.position_x * zoom,
        y: height / 2 - comment.position_y * zoom,
        zoom,
      })
    },
    [direction, flowStore, reactflow, workflowStore],
  )

  const handleCommentIconClick = useCallback(
    async (comment: WorkflowCommentBasic) => {
      setPendingComment(null)

      activeCommentIdRef.current = comment.id
      setActiveCommentId(comment.id)

      const cachedDetail = workflowStore.getState().commentDetailCache[comment.id]
      setActiveComment(cachedDetail ?? toCommentDetailPreview(comment))

      if (!appId) return

      setActiveCommentLoading(!cachedDetail)

      try {
        await fetchCommentDetail(comment.id)
      } catch (e) {
        console.warn('Failed to load workflow comment detail', e)
      } finally {
        if (activeCommentIdRef.current === comment.id) setActiveCommentLoading(false)
      }
    },
    [
      appId,
      fetchCommentDetail,
      workflowStore,
      setActiveComment,
      setActiveCommentId,
      setActiveCommentLoading,
      setPendingComment,
    ],
  )

  // Selects a comment the user may not be looking at and brings it into view.
  const handleCommentReveal = useCallback(
    (comment: WorkflowCommentBasic) => {
      revealComment(comment)
      return handleCommentIconClick(comment)
    },
    [handleCommentIconClick, revealComment],
  )

  // Resolving shows on the thread at once. The comment leaves the list (and the canvas,
  // when resolved comments are hidden) only once the server has it, so a failed request
  // never closes a thread that still holds an unsent draft.
  const handleCommentResolve = useCallback(
    async (commentId: string) => {
      if (!appId) return

      versions.resolving.add(commentId)
      patchCommentDetail(commentId, (detail) => ({ ...detail, resolved: true }))
      try {
        const result = await consoleClient.apps.byAppId.workflow.comments.byCommentId.resolve.post({
          params: { app_id: appId, comment_id: commentId },
        })

        collaborationManager.emitCommentsUpdate(appId)

        patchCommentDetail(commentId, (detail) => ({
          ...detail,
          resolved: result.resolved,
          resolved_at: result.resolved_at,
          resolved_by: result.resolved_by,
        }))
        versions.list += 1
        setComments(
          workflowStore
            .getState()
            .comments.map((comment) =>
              comment.id === commentId ? { ...comment, resolved: result.resolved } : comment,
            ),
        )
      } catch (error) {
        console.error('Failed to resolve comment:', error)
        patchCommentDetail(commentId, (detail) => ({ ...detail, resolved: false }))
      } finally {
        versions.resolving.delete(commentId)
        syncComment(commentId)
      }
    },
    [appId, patchCommentDetail, setComments, syncComment, versions, workflowStore],
  )

  const handleCommentDelete = useCallback(
    async (commentId: string) => {
      if (!appId) return

      try {
        await consoleClient.apps.byAppId.workflow.comments.byCommentId.delete({
          params: { app_id: appId, comment_id: commentId },
        })

        collaborationManager.emitCommentsUpdate(appId)

        const updatedCache = { ...workflowStore.getState().commentDetailCache }
        delete updatedCache[commentId]
        setCommentDetailCache(updatedCache)

        // Read the list as it is now; it may have changed while the request ran.
        versions.list += 1
        setComments(workflowStore.getState().comments.filter((c) => c.id !== commentId))
        loadComments()

        // The thread just closes; the detail clears once it finishes closing.
        if (activeCommentIdRef.current === commentId) {
          setActiveCommentId(null)
          activeCommentIdRef.current = null
        }
      } catch (error) {
        console.error('Failed to delete comment:', error)
      }
    },
    [
      appId,
      loadComments,
      setActiveCommentId,
      setCommentDetailCache,
      setComments,
      versions,
      workflowStore,
    ],
  )

  const handleCommentPositionUpdate = useCallback(
    async (commentId: string, position: { x: number; y: number }) => {
      if (!appId) return

      const targetComment = workflowStore.getState().comments.find((c) => c.id === commentId)
      if (!targetComment) return

      // Only the position moves, on the latest list and detail, so a failed move puts back
      // the position alone and keeps everything written to the thread meanwhile.
      const setPosition = (value: { position_x: number; position_y: number }) => {
        versions.list += 1
        setComments(
          workflowStore
            .getState()
            .comments.map((comment) =>
              comment.id === commentId ? { ...comment, ...value } : comment,
            ),
        )
        patchCommentDetail(commentId, (detail) => ({ ...detail, ...value }))
      }
      setPosition({ position_x: position.x, position_y: position.y })

      try {
        await consoleClient.apps.byAppId.workflow.comments.byCommentId.put({
          params: { app_id: appId, comment_id: commentId },
          body: {
            content: targetComment.content,
            position_x: position.x,
            position_y: position.y,
          },
        })
        collaborationManager.emitCommentsUpdate(appId)
      } catch (error) {
        console.error('Failed to update comment position:', error)
        setPosition({ position_x: targetComment.position_x, position_y: targetComment.position_y })
      } finally {
        syncComment(commentId)
      }
    },
    [appId, patchCommentDetail, setComments, syncComment, versions, workflowStore],
  )

  const handleCommentUpdate = useCallback(
    async (commentId: string, content: string, mentionedUserIds: string[] = []) => {
      if (!appId) return
      const trimmed = content.trim()
      if (!trimmed) return

      const targetComment = comments.find((c) => c.id === commentId)
      const targetDetail =
        workflowStore.getState().commentDetailCache[commentId] ??
        (activeCommentIdRef.current === commentId ? activeComment : null)
      const positionX = targetDetail?.position_x ?? targetComment?.position_x
      const positionY = targetDetail?.position_y ?? targetComment?.position_y

      if (positionX === undefined || positionY === undefined) return

      try {
        await consoleClient.apps.byAppId.workflow.comments.byCommentId.put({
          params: { app_id: appId, comment_id: commentId },
          body: {
            content: trimmed,
            position_x: positionX,
            position_y: positionY,
            mentioned_user_ids: mentionedUserIds,
          },
        })

        collaborationManager.emitCommentsUpdate(appId)

        patchCommentDetail(commentId, (detail) => ({ ...detail, content: trimmed }))
        syncComment(commentId)
      } catch (error) {
        console.error('Failed to update comment:', error)
      }
    },
    [activeComment, appId, comments, patchCommentDetail, syncComment, workflowStore],
  )

  // Sends a reply already shown in the thread under its local id. On success it takes the
  // server's id; on failure it stays in the thread, marked failed, to be sent again.
  const sendReply = useCallback(
    async (commentId: string, localId: string, content: string, mentionedUserIds: string[]) => {
      if (!appId) return
      try {
        const reply = await consoleClient.apps.byAppId.workflow.comments.byCommentId.replies.post({
          params: { app_id: appId, comment_id: commentId },
          body: { content, mentioned_user_ids: mentionedUserIds },
        })

        collaborationManager.emitCommentsUpdate(appId)

        patchCommentDetail(commentId, (detail) => {
          // A refetch may already have brought the saved reply in.
          const alreadyFetched = detail.replies.some((item) => item.id === reply.id)
          const replies: ThreadReply[] = alreadyFetched
            ? detail.replies.filter((item) => item.id !== localId)
            : detail.replies.map((item: ThreadReply) =>
                item.id === localId
                  ? {
                      ...item,
                      id: reply.id,
                      created_at: normalizeTimestamp(reply.created_at),
                      send_state: undefined,
                      mentioned_user_ids: undefined,
                    }
                  : item,
              )
          return {
            ...detail,
            replies,
            mentions: [
              ...detail.mentions,
              ...mentionedUserIds.map((mentionedId) => ({
                mentioned_user_id: mentionedId,
                mentioned_user_account: mentionableUserById.get(mentionedId) ?? null,
                reply_id: reply.id,
              })),
            ],
          }
        })
      } catch (error) {
        console.error('Failed to create reply:', error)
        patchCommentDetail(
          commentId,
          (detail) => ({
            ...detail,
            replies: detail.replies.map((item: ThreadReply) =>
              item.id === localId ? { ...item, send_state: 'failed' as const } : item,
            ),
          }),
          { invalidate: false },
        )
      } finally {
        syncComment(commentId)
      }
    },
    [appId, mentionableUserById, patchCommentDetail, syncComment],
  )

  const handleCommentReply = useCallback(
    async (commentId: string, content: string, mentionedUserIds: string[] = []) => {
      if (!appId) return
      const trimmed = content.trim()
      if (!trimmed) return

      // The reply shows at once under a local id, so the reply box is free for the next one.
      const localId = createLocalReplyId()
      const localReply: ThreadReply = {
        id: localId,
        client_key: localId,
        send_state: 'pending',
        mentioned_user_ids: mentionedUserIds,
        content: trimmed,
        created_at: Math.floor(Date.now() / 1000),
        created_by: userProfile.id,
        created_by_account: {
          id: userProfile.id,
          name: userProfile.name,
          email: userProfile.email,
          avatar_url: userProfile.avatar_url || userProfile.avatar || null,
        },
      }
      // Refetches keep unsent replies, so showing one does not invalidate them.
      patchCommentDetail(
        commentId,
        (detail) => ({ ...detail, replies: [...detail.replies, localReply] }),
        { invalidate: false },
      )
      await sendReply(commentId, localId, trimmed, mentionedUserIds)
    },
    [appId, patchCommentDetail, sendReply, userProfile],
  )

  const handleCommentReplyRetry = useCallback(
    async (commentId: string, localId: string) => {
      const findReply = () => {
        const state = workflowStore.getState()
        const detail =
          state.commentDetailCache[commentId] ??
          (state.activeCommentId === commentId ? state.activeCommentDetail : null)
        return detail?.replies.find((item) => item.id === localId) as ThreadReply | undefined
      }
      const reply = findReply()
      if (!reply || reply.send_state !== 'failed') return
      patchCommentDetail(
        commentId,
        (current) => ({
          ...current,
          replies: current.replies.map((item: ThreadReply) =>
            item.id === localId ? { ...item, send_state: 'pending' as const } : item,
          ),
        }),
        { invalidate: false },
      )
      // A reply whose response was lost may be saved already: refetching drops the local
      // copy if so, and only a reply still unsaved is sent again.
      try {
        await fetchCommentDetail(commentId)
      } catch (error) {
        console.error('Failed to refresh the thread before retrying a reply:', error)
      }
      if (!findReply()) return
      await sendReply(commentId, localId, reply.content, reply.mentioned_user_ids ?? [])
    },
    [fetchCommentDetail, patchCommentDetail, sendReply, workflowStore],
  )

  const handleCommentReplyDiscard = useCallback(
    (commentId: string, localId: string) => {
      patchCommentDetail(
        commentId,
        (detail) => ({
          ...detail,
          replies: detail.replies.filter((item) => item.id !== localId),
        }),
        { invalidate: false },
      )
    },
    [patchCommentDetail],
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

      setReplyUpdating(true)
      try {
        await consoleClient.apps.byAppId.workflow.comments.byCommentId.replies.byReplyId.put({
          params: { app_id: appId, comment_id: commentId, reply_id: replyId },
          body: { content: trimmed, mentioned_user_ids: mentionedUserIds },
        })

        collaborationManager.emitCommentsUpdate(appId)

        patchCommentDetail(commentId, (detail) => ({
          ...detail,
          replies: detail.replies.map((reply) =>
            reply.id === replyId ? { ...reply, content: trimmed } : reply,
          ),
        }))
        syncComment(commentId)
      } catch (error) {
        console.error('Failed to update reply:', error)
      } finally {
        setReplyUpdating(false)
      }
    },
    [appId, patchCommentDetail, setReplyUpdating, syncComment],
  )

  const handleCommentReplyDelete = useCallback(
    async (commentId: string, replyId: string) => {
      if (!appId) return

      try {
        await consoleClient.apps.byAppId.workflow.comments.byCommentId.replies.byReplyId.delete({
          params: { app_id: appId, comment_id: commentId, reply_id: replyId },
        })

        collaborationManager.emitCommentsUpdate(appId)

        patchCommentDetail(commentId, (detail) => ({
          ...detail,
          replies: detail.replies.filter((reply) => reply.id !== replyId),
          mentions: detail.mentions.filter((mention) => mention.reply_id !== replyId),
        }))
        syncComment(commentId)
      } catch (error) {
        console.error('Failed to delete reply:', error)
      }
    },
    [appId, patchCommentDetail, syncComment],
  )

  // Closing deselects the comment; its detail stays for the thread's closing transition
  // until handleActiveCommentClosed clears it.
  const handleActiveCommentClose = useCallback(() => {
    setActiveCommentLoading(false)
    setActiveCommentId(null)
    activeCommentIdRef.current = null
  }, [setActiveCommentId, setActiveCommentLoading])

  // The thread finished closing, whether it was dismissed or its comment left the visible
  // list (deleted or filtered out); either way this viewing session is over.
  const handleActiveCommentClosed = useCallback(() => {
    setActiveComment(null)
    setActiveCommentLoading(false)
    setActiveCommentId(null)
    activeCommentIdRef.current = null
  }, [setActiveComment, setActiveCommentId, setActiveCommentLoading])

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
    replyUpdating,
    handleCommentSubmit,
    handleCommentCancel,
    handleCommentIconClick,
    handleCommentReveal,
    handleActiveCommentClose,
    handleActiveCommentClosed,
    handleCommentResolve,
    handleCommentDelete,
    handleCommentUpdate,
    handleCommentReply,
    handleCommentReplyRetry,
    handleCommentReplyDiscard,
    handleCommentReplyUpdate,
    handleCommentReplyDelete,
    handleCommentPositionUpdate,
    refreshActiveComment,
    handleCreateComment,
    loadComments,
  }
}
