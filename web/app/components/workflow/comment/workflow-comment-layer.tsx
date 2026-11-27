import type {
  WorkflowCommentBasic,
  WorkflowCommentDetail,
} from '@dify/contracts/api/console/apps/types.gen'
import type { Mutation, MutationKey, QueryClient } from '@tanstack/react-query'
import type { ThreadReply } from './pending-reply'
import {
  createPopoverHandle,
  Popover,
  PopoverPortal,
  PopoverPositioner,
} from '@langgenius/dify-ui/popover'
import {
  matchMutation,
  matchQuery,
  skipToken,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackCollabCommentSent } from '@/app/components/workflow/collaboration/analytics'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import {
  editorAppIdAtom,
  editorCollaborationEnabledAtom,
} from '@/app/components/workflow/editor-resource/state'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import { useStore, useWorkflowStore } from '../store'
import { ControlMode } from '../types'
import { CommentIcon } from './comment-icon'
import { CommentInput } from './comment-input'
import { prefetchCommentThread } from './comment-prefetch'
import { appIdOfWrite, commentWriteKey, isWritingComments } from './comment-writes'
import { getCommentMarkerId } from './marker-id'
import { CommentPlacementPreview } from './placement-preview'
import { commentThreadPlacement, useCommentPopupBounds } from './popup-placement'
import { CommentThread } from './thread'
import { useRevealComment } from './use-reveal-comment'

const commentsApi = consoleQuery.apps.byAppId.workflow.comments
const replySendKey = commentsApi.byCommentId.replies.post.mutationKey()
const editCommentKey = commentsApi.byCommentId.put.mutationKey()
const editReplyKey = commentsApi.byCommentId.replies.byReplyId.put.mutationKey()
const deleteCommentKey = commentsApi.byCommentId.delete.mutationKey()
const deleteReplyKey = commentsApi.byCommentId.replies.byReplyId.delete.mutationKey()

// The comments and replies that running writes of these kinds change, by id. Read from the
// mutations, so a thread shown again still knows a write it started is running.
const pendingWriteIdsOf = (mutationKeys: MutationKey[]) => ({
  filters: {
    status: 'pending' as const,
    predicate: (mutation: Mutation) =>
      mutationKeys.some((mutationKey) => matchMutation({ mutationKey }, mutation)),
  },
  select: (mutation: Mutation) => {
    const { params } = mutation.state.variables as {
      params: { comment_id: string; reply_id?: string }
    }
    return params.reply_id ?? params.comment_id
  },
})
const EMPTY_COMMENTS: WorkflowCommentBasic[] = []

type CommentParams = { app_id: string; comment_id: string }

const listKeyOf = (appId: string) =>
  commentsApi.get.queryKey({ input: { params: { app_id: appId } } })
const detailKeyOf = (params: CommentParams) =>
  commentsApi.byCommentId.get.queryKey({ input: { params } })

const updateDetail = (
  client: QueryClient,
  params: CommentParams,
  update: (detail: WorkflowCommentDetail) => WorkflowCommentDetail,
) => client.setQueryData(detailKeyOf(params), (detail) => (detail ? update(detail) : detail))

const updateList = (
  client: QueryClient,
  appId: string,
  update: (comments: WorkflowCommentBasic[]) => WorkflowCommentBasic[],
) =>
  client.setQueryData(listKeyOf(appId), (list) =>
    list ? { ...list, data: update(list.data) } : list,
  )

// An optimistic write first stops fetches already running for the comment, so their older
// results cannot land on top of it.
const cancelCommentFetches = (client: QueryClient, params: CommentParams) =>
  Promise.all([
    client.cancelQueries({ queryKey: listKeyOf(params.app_id) }),
    client.cancelQueries({ queryKey: detailKeyOf(params) }),
  ])

// The app's comment list and details; mentionable users do not change with comments.
// Sends to threads that are gone, deleted here or by a collaborator, go with them.
const refetchComments = async (client: QueryClient, appId: string) => {
  await Promise.all([
    client.invalidateQueries({
      queryKey: commentsApi.get.key({ input: { params: { app_id: appId } } }),
    }),
    client.invalidateQueries({
      queryKey: commentsApi.byCommentId.get.key({ input: { params: { app_id: appId } } }),
    }),
  ])
  const list = client.getQueryData(listKeyOf(appId))
  if (!list) return
  const ids = new Set(list.data.map((comment) => comment.id))
  const cache = client.getMutationCache()
  for (const send of cache.findAll({
    mutationKey: replySendKey,
    predicate: (mutation) => {
      const params = (mutation.state.variables as ReplySendVariables | undefined)?.params
      return params?.app_id === appId && !ids.has(params.comment_id)
    },
  }))
    cache.remove(send)
}

type ReplySendVariables = {
  params: CommentParams
  body: { content: string; mentioned_user_ids?: string[] }
}
const sendKeyOf = (mutation: Pick<Mutation, 'mutationId'>) => `local-${mutation.mutationId}`

/**
 * The canvas's comments: the composer for a new one, the markers, and the one thread
 * popover every marker triggers. The selected comment decides whether the thread is open
 * and which marker anchors it; the thread keeps showing a comment until it finishes closing.
 */
export function WorkflowCommentLayer() {
  const appId = useAtomValue(editorAppIdAtom)
  const isCollaborationEnabled = useAtomValue(editorCollaborationEnabledAtom)
  const workspaceId = useAtomValue(currentWorkspaceIdAtom)
  const queryClient = useQueryClient()
  const popupBounds = useCommentPopupBounds()
  const workflowStore = useWorkflowStore()
  const revealComment = useRevealComment()
  const controlMode = useStore((s) => s.controlMode)
  const showUserComments = useStore((s) => s.showUserComments)
  const showResolvedComments = useStore((s) => s.showResolvedComments)
  const pendingComment = useStore((s) => s.pendingComment)
  const activeCommentId = useStore((s) => s.activeCommentId) ?? null
  const setActiveCommentId = useStore((s) => s.setActiveCommentId)
  const [threadHandle] = useState(() => createPopoverHandle())
  const { data: author } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: ({ profile }) => ({
      id: profile.id,
      name: profile.name,
      email: profile.email,
      avatar_url: profile.avatar_url ?? null,
    }),
  })

  // Comments are read again on mount or when a thread switches to them, except while a write
  // from here is running for the app; the reconcile after it reads them.
  const { data: comments = EMPTY_COMMENTS } = useQuery({
    ...commentsApi.get.queryOptions({
      input: appId ? { params: { app_id: appId } } : skipToken,
      enabled: isCollaborationEnabled,
      staleTime: () => (appId && isWritingComments(queryClient, appId) ? Infinity : 0),
    }),
    select: (list) => list.data,
  })

  // Every comment write, from the thread, the markers or the comments panel, is told to
  // collaborators once it succeeds, and an app's comments reconcile with the server once no
  // write to them is still running, so a refetch never lands on a write's optimistic state.
  const unreconciledRef = useRef(new Set<string>())
  useEffect(() => {
    const mutationCache = queryClient.getMutationCache()
    const unreconciled = unreconciledRef.current
    return mutationCache.subscribe((event) => {
      if (
        event.type !== 'updated' ||
        !matchMutation({ mutationKey: commentWriteKey }, event.mutation)
      )
        return
      const { type } = event.action
      if (type !== 'success' && type !== 'error') return
      const writtenAppId = appIdOfWrite(event.mutation.state.variables)
      if (!writtenAppId) return
      if (type === 'success') collaborationManager.emitCommentsUpdate(writtenAppId)
      unreconciled.add(writtenAppId)
      queueMicrotask(() => {
        for (const id of unreconciled) {
          if (isWritingComments(queryClient, id)) continue
          unreconciled.delete(id)
          void refetchComments(queryClient, id)
        }
      })
    })
  }, [queryClient])

  // A collaborator's change refetches the comments, or, while a write from here is running,
  // waits for the reconcile once writes settle.
  useEffect(() => {
    if (!appId || !isCollaborationEnabled) return
    return collaborationManager.onCommentsUpdate(() => {
      if (isWritingComments(queryClient, appId)) unreconciledRef.current.add(appId)
      else void refetchComments(queryClient, appId)
    })
  }, [appId, isCollaborationEnabled, queryClient])

  // A new comment's composer keeps its text until the comment is on the canvas.
  const createComment = useMutation(
    commentsApi.post.mutationOptions({
      onSuccess: (created, { params, body }) => {
        trackCollabCommentSent({
          workspace_id: workspaceId,
          app_id: params.app_id,
          thread_id: created.id,
          comment_id: created.id,
          comment_kind: 'thread',
        })
        const createdAt = created.created_at ?? Math.floor(Date.now() / 1000)
        updateList(queryClient, params.app_id, (list) => [
          ...list,
          {
            id: created.id,
            position_x: body.position_x,
            position_y: body.position_y,
            content: body.content,
            created_by: author.id,
            created_by_account: author,
            created_at: createdAt,
            updated_at: createdAt,
            resolved: false,
            mention_count: body.mentioned_user_ids?.length ?? 0,
            reply_count: 0,
            participants: [author],
          },
        ])
      },
    }),
  )
  const submitComment = async (content: string, mentionedUserIds: string[]) => {
    if (!pendingComment || !appId) return
    try {
      await createComment.mutateAsync({
        params: { app_id: appId },
        body: {
          position_x: pendingComment.x,
          position_y: pendingComment.y,
          content,
          mentioned_user_ids: mentionedUserIds,
        },
      })
      workflowStore.getState().setPendingComment(null)
    } catch (error) {
      console.error('Failed to create comment:', error)
    }
  }
  // Stable, so a drag in progress is not torn down by each position it reports.
  const moveDraft = useCallback(
    (position: NonNullable<typeof pendingComment>) =>
      workflowStore.setState({ pendingComment: position }),
    [workflowStore],
  )

  // Moving a marker shows its new position at once; a failed move puts back the position
  // alone, keeping anything written to the thread meanwhile.
  const { mutate: moveComment } = useMutation(
    commentsApi.byCommentId.put.mutationOptions({
      onMutate: async ({ params, body }) => {
        await cancelCommentFetches(queryClient, params)
        const setPosition = (position_x: number, position_y: number) => {
          updateList(queryClient, params.app_id, (list) =>
            list.map((comment) =>
              comment.id === params.comment_id ? { ...comment, position_x, position_y } : comment,
            ),
          )
          updateDetail(queryClient, params, (detail) => ({ ...detail, position_x, position_y }))
        }
        const previous = queryClient
          .getQueryData(listKeyOf(params.app_id))
          ?.data.find((comment) => comment.id === params.comment_id)
        if (body.position_x == null || body.position_y == null) return {}
        setPosition(body.position_x, body.position_y)
        return {
          restore: previous
            ? () => setPosition(previous.position_x, previous.position_y)
            : undefined,
        }
      },
      onError: (error, _variables, context) => {
        console.error('Failed to move comment:', error)
        context?.restore?.()
      },
    }),
  )
  // A thread is read ahead when its marker's preview opens, and the threads beside it when it
  // becomes the open one, so opening or stepping to a thread shows its replies at once.
  const prefetchThread = useCallback(
    (commentId: string) => {
      if (appId) prefetchCommentThread(queryClient, { app_id: appId, comment_id: commentId })
    },
    [appId, queryClient],
  )
  useEffect(() => {
    if (!appId) return
    const listKey = listKeyOf(appId)
    const prefetchNeighbors = () => {
      const { activeCommentId: shownId, showResolvedComments } = workflowStore.getState()
      if (!shownId) return
      const list = queryClient.getQueryData(listKey)?.data ?? []
      const shown = showResolvedComments ? list : list.filter((comment) => !comment.resolved)
      const index = shown.findIndex((comment) => comment.id === shownId)
      if (index === -1) return
      for (const neighbor of [shown[index - 1], shown[index + 1]]) {
        if (neighbor) prefetchCommentThread(queryClient, { app_id: appId, comment_id: neighbor.id })
      }
    }
    // The neighbors change when another thread opens, and when the list changes around it.
    const stopSelection = workflowStore.subscribe((state, previous) => {
      if (state.activeCommentId !== previous.activeCommentId) prefetchNeighbors()
    })
    const stopList = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === 'updated' &&
        event.action.type === 'success' &&
        matchQuery({ queryKey: listKey, exact: true }, event.query)
      )
        prefetchNeighbors()
    })
    return () => {
      stopSelection()
      stopList()
    }
  }, [appId, queryClient, workflowStore])

  // Stable across list changes, so moving one marker does not re-render the others: the
  // comment's text is read from the cache when it moves.
  const moveCommentTo = useCallback(
    (commentId: string, position: { x: number; y: number }) => {
      if (!appId) return
      const comment = queryClient
        .getQueryData(listKeyOf(appId))
        ?.data.find((item) => item.id === commentId)
      if (!comment) return
      moveComment({
        params: { app_id: appId, comment_id: commentId },
        body: { content: comment.content, position_x: position.x, position_y: position.y },
      })
    },
    [appId, moveComment, queryClient],
  )

  // The comment the thread shows: the selected one, kept after deselection (or deletion)
  // until the thread finishes closing.
  const activeComment = activeCommentId
    ? comments.find((comment) => comment.id === activeCommentId)
    : undefined
  const [shownComment, setShownComment] = useState<WorkflowCommentBasic | null>(null)
  if (activeComment && activeComment !== shownComment) setShownComment(activeComment)

  const visibleComments = showResolvedComments
    ? comments
    : comments.filter((comment) => !comment.resolved)
  const activeIndex = activeCommentId
    ? visibleComments.findIndex((comment) => comment.id === activeCommentId)
    : -1
  const open = activeIndex !== -1
  const previous = visibleComments[activeIndex - 1]
  const next = activeIndex === -1 ? undefined : visibleComments[activeIndex + 1]

  return (
    <>
      <CommentPlacementPreview
        onSubmit={submitComment}
        onCancel={() =>
          workflowStore.setState({
            pendingComment: null,
            isCommentPlacing: false,
            isCommentQuickAdd: false,
          })
        }
      />
      {pendingComment && (
        <CommentInput
          position={pendingComment}
          onSubmit={submitComment}
          submitting={createComment.isPending}
          onCancel={() => workflowStore.getState().setPendingComment(null)}
          onPositionChange={moveDraft}
        />
      )}
      {visibleComments.map((comment) =>
        comment.id === activeCommentId ||
        showUserComments ||
        controlMode === ControlMode.Comment ? (
          <CommentIcon
            key={comment.id}
            comment={comment}
            threadHandle={threadHandle}
            isActive={open && comment.id === activeCommentId}
            onPositionUpdate={moveCommentTo}
            onPreview={prefetchThread}
          />
        ) : null,
      )}
      <Popover
        handle={threadHandle}
        open={open}
        triggerId={activeCommentId ? getCommentMarkerId(activeCommentId) : null}
        onOpenChange={(nextOpen, eventDetails) => {
          if (!nextOpen) {
            // A comment's hover preview stands in for its marker: pressing it switches the
            // thread to that marker instead of closing this one first.
            const target = eventDetails.event.target
            if (
              eventDetails.reason === 'outside-press' &&
              target instanceof Element &&
              target.closest('[data-role="comment-preview"]')
            ) {
              eventDetails.cancel()
              return
            }
            setActiveCommentId(null)
            return
          }
          const comment = visibleComments.find(
            (candidate) => getCommentMarkerId(candidate.id) === eventDetails.trigger?.id,
          )
          if (comment) {
            workflowStore.getState().setPendingComment(null)
            setActiveCommentId(comment.id)
          }
        }}
        onOpenChangeComplete={(nextOpen) => {
          // A thread opened again before the close finished keeps its session.
          if (nextOpen || open) return
          // It may have closed because its comment left the visible list.
          setActiveCommentId(null)
          setShownComment(null)
        }}
      >
        <PopoverPortal>
          <PopoverPositioner {...commentThreadPlacement} {...popupBounds}>
            {appId && shownComment && (
              <ShownThread
                appId={appId}
                listItem={shownComment}
                author={author}
                onPrev={previous ? () => revealComment(previous) : undefined}
                onNext={next ? () => revealComment(next) : undefined}
              />
            )}
          </PopoverPositioner>
        </PopoverPortal>
      </Popover>
    </>
  )
}

/**
 * The thread for one comment: its detail (the list item stands in until, or instead of, the
 * first load) and every write to it. Each write takes its target from its own variables.
 * A reply shows as soon as it is sent, from its send mutation; a failed send stays so it
 * can be sent again or dropped.
 */
function ShownThread({
  appId,
  listItem,
  author,
  onPrev,
  onNext,
}: {
  appId: string
  listItem: WorkflowCommentBasic
  author: NonNullable<WorkflowCommentBasic['created_by_account']>
  onPrev?: () => void
  onNext?: () => void
}) {
  const queryClient = useQueryClient()
  const workflowStore = useWorkflowStore()
  const workspaceId = useAtomValue(currentWorkspaceIdAtom)
  const params = { app_id: appId, comment_id: listItem.id }
  const detailQuery = useQuery(
    commentsApi.byCommentId.get.queryOptions({
      input: { params },
      placeholderData: { ...listItem, replies: [], mentions: [] },
      staleTime: () => (isWritingComments(queryClient, params.app_id) ? Infinity : 0),
    }),
  )
  const { t } = useTranslation(['workflow'])
  const detailLoad = useOwnedQueryError(detailQuery)
  const detailLoadErrorMessage = useRequestErrorMessage(
    detailLoad?.error,
    t(($) => $['common.loadFailed'], { ns: 'workflow' }),
  )

  // A saved reply keeps the key of its send row, so the row is not remounted.
  const [sentKeys, setSentKeys] = useState<ReadonlyMap<string, string>>(() => new Map())
  const sendReply = useMutation(
    commentsApi.byCommentId.replies.post.mutationOptions({
      // A failed send stays until it is sent again or dropped.
      gcTime: Infinity,
      onMutate: async ({ params: target }) => {
        const cache = queryClient.getMutationCache()
        for (const mutation of cache.findAll({ mutationKey: replySendKey, status: 'success' }))
          cache.remove(mutation)
        await queryClient.cancelQueries({ queryKey: detailKeyOf(target) })
      },
      // The saved reply takes the send row's place at once, under the same key. A thread
      // whose detail never loaded starts one from its list item, as it was being shown.
      onSuccess: (reply, variables) => {
        const send = queryClient.getMutationCache().find({
          mutationKey: replySendKey,
          predicate: (mutation) => mutation.state.variables === variables,
        })
        if (send) setSentKeys((keys) => new Map(keys).set(reply.id, sendKeyOf(send)))
        const saved = {
          id: reply.id,
          content: variables.body.content,
          created_at: reply.created_at ?? Math.floor(Date.now() / 1000),
          created_by: author.id,
          created_by_account: author,
        }
        const { params } = variables
        const thread = queryClient
          .getQueryData(listKeyOf(params.app_id))
          ?.data.find((item) => item.id === params.comment_id)
        const threadAuthor = (queryClient.getQueryData(detailKeyOf(params)) ?? thread)?.created_by
        trackCollabCommentSent({
          workspace_id: workspaceId,
          app_id: params.app_id,
          thread_id: params.comment_id,
          comment_id: reply.id,
          comment_kind: 'reply',
          is_thread_author: threadAuthor === author.id,
        })
        queryClient.setQueryData(detailKeyOf(params), (detail) => {
          if (detail)
            return detail.replies.some((item) => item.id === reply.id)
              ? detail
              : { ...detail, replies: [...detail.replies, saved] }
          return thread && { ...thread, replies: [saved], mentions: [] }
        })
      },
    }),
  )
  const sends = useMutationState({
    filters: {
      mutationKey: replySendKey,
      predicate: (mutation) =>
        (mutation.state.variables as ReplySendVariables | undefined)?.params.comment_id ===
          listItem.id && mutation.state.status !== 'success',
    },
    select: (mutation): ThreadReply => {
      const variables = mutation.state.variables as ReplySendVariables
      return {
        id: sendKeyOf(mutation),
        client_key: sendKeyOf(mutation),
        content: variables.body.content,
        created_at: Math.floor(mutation.state.submittedAt / 1000),
        created_by: author.id,
        created_by_account: author,
        send_state: mutation.state.status === 'error' ? 'failed' : 'pending',
      }
    },
  })

  const detail = detailQuery.data ?? { ...listItem, replies: [], mentions: [] }
  const comment = {
    ...detail,
    replies: [
      ...detail.replies.map((reply): ThreadReply => {
        const clientKey = sentKeys.get(reply.id)
        return clientKey ? { ...reply, client_key: clientKey } : reply
      }),
      ...sends,
    ],
  }

  const findSend = (key: string) =>
    queryClient.getMutationCache().find<unknown, unknown, ReplySendVariables>({
      mutationKey: replySendKey,
      predicate: (mutation) => sendKeyOf(mutation) === key,
    })
  // Sending again replaces the failed send at once, so a second press finds nothing to retry.
  // The backend has no idempotency key: a send whose response was lost but which was saved
  // shows as saved after the comments reconcile, beside its failed row, which can be dropped.
  const retryReply = (key: string) => {
    const failed = findSend(key)
    const variables = failed?.state.variables
    if (!failed || !variables || failed.state.status !== 'error') return
    queryClient.getMutationCache().remove(failed)
    sendReply.mutate(variables)
  }

  const editComment = useMutation(
    commentsApi.byCommentId.put.mutationOptions({
      // A read already running would otherwise land the old text after the edit.
      onMutate: ({ params: target }) => cancelCommentFetches(queryClient, target),
      onSuccess: (_data, { params: target, body }) => {
        updateDetail(queryClient, target, (current) => ({ ...current, content: body.content }))
        updateList(queryClient, target.app_id, (list) =>
          list.map((item) =>
            item.id === target.comment_id ? { ...item, content: body.content } : item,
          ),
        )
      },
    }),
  )
  const editReply = useMutation(
    commentsApi.byCommentId.replies.byReplyId.put.mutationOptions({
      onMutate: ({ params: { reply_id: _replyId, ...target } }) =>
        cancelCommentFetches(queryClient, target),
      onSuccess: (_data, { params: { reply_id, ...target }, body }) =>
        updateDetail(queryClient, target, (current) => ({
          ...current,
          replies: current.replies.map((reply) =>
            reply.id === reply_id ? { ...reply, content: body.content } : reply,
          ),
        })),
    }),
  )
  const deleteReply = useMutation(
    commentsApi.byCommentId.replies.byReplyId.delete.mutationOptions({
      onMutate: ({ params: { reply_id: _replyId, ...target } }) =>
        cancelCommentFetches(queryClient, target),
      onSuccess: (_data, { params: { reply_id, ...target } }) => {
        updateDetail(queryClient, target, (current) => ({
          ...current,
          replies: current.replies.filter((reply) => reply.id !== reply_id),
          mentions: current.mentions.filter((mention) => mention.reply_id !== reply_id),
        }))
      },
    }),
  )
  const deleteComment = useMutation(
    commentsApi.byCommentId.delete.mutationOptions({
      onSuccess: (_data, { params: target }) => {
        updateList(queryClient, target.app_id, (list) =>
          list.filter((item) => item.id !== target.comment_id),
        )
        const cache = queryClient.getMutationCache()
        for (const mutation of cache.findAll({
          mutationKey: replySendKey,
          predicate: (send) =>
            (send.state.variables as ReplySendVariables | undefined)?.params.comment_id ===
            target.comment_id,
        }))
          cache.remove(mutation)
        // The thread just closes; its detail stays for the closing transition.
        const { activeCommentId, setActiveCommentId } = workflowStore.getState()
        if (activeCommentId === target.comment_id) setActiveCommentId(null)
      },
    }),
  )
  const resolveComment = useMutation(commentsApi.byCommentId.resolve.post.mutationOptions())
  // A marker move writes the comment the same way as an edit, so it holds the comment's edit
  // for its short request too.
  const savingIds = useMutationState(pendingWriteIdsOf([editCommentKey, editReplyKey]))
  const deletingIds = useMutationState(pendingWriteIdsOf([deleteCommentKey, deleteReplyKey]))

  return (
    <CommentThread
      comment={comment}
      loading={detailQuery.isPlaceholderData}
      loadError={
        detailLoad && detailLoadErrorMessage
          ? { message: detailLoadErrorMessage, onRetry: detailLoad.retry }
          : undefined
      }
      onResolve={() => resolveComment.mutate({ params })}
      onDelete={async () => {
        try {
          await deleteComment.mutateAsync({ params })
        } catch (error) {
          console.error('Failed to delete comment:', error)
        }
      }}
      onCommentEdit={async (content, ids) => {
        const trimmed = content.trim()
        if (!trimmed) return
        await editComment.mutateAsync({
          params,
          body: {
            content: trimmed,
            position_x: comment.position_x,
            position_y: comment.position_y,
            mentioned_user_ids: ids ?? [],
          },
        })
      }}
      onPrev={onPrev}
      onNext={onNext}
      savingIds={savingIds}
      deletingIds={deletingIds}
      onReply={(content, ids) => {
        const trimmed = content.trim()
        if (trimmed)
          sendReply.mutate({ params, body: { content: trimmed, mentioned_user_ids: ids ?? [] } })
      }}
      onReplyEdit={async (replyId, content, ids) => {
        const trimmed = content.trim()
        if (!trimmed) return
        await editReply.mutateAsync({
          params: { ...params, reply_id: replyId },
          body: { content: trimmed, mentioned_user_ids: ids ?? [] },
        })
      }}
      onReplyDelete={async (replyId) => {
        try {
          await deleteReply.mutateAsync({ params: { ...params, reply_id: replyId } })
        } catch (error) {
          console.error('Failed to delete reply:', error)
        }
      }}
      onReplyRetry={retryReply}
      onReplyDiscard={(key) => {
        const failed = findSend(key)
        if (failed) queryClient.getMutationCache().remove(failed)
      }}
    />
  )
}
