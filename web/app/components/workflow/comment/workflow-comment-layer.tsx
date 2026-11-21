import type {
  WorkflowCommentBasic,
  WorkflowCommentDetail,
} from '@dify/contracts/api/console/apps/types.gen'
import type { Mutation, QueryClient } from '@tanstack/react-query'
import type { ThreadReply } from './pending-reply'
import {
  createPopoverHandle,
  Popover,
  PopoverPortal,
  PopoverPositioner,
} from '@langgenius/dify-ui/popover'
import {
  skipToken,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import { useReactFlow } from 'reactflow'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import {
  editorAppIdAtom,
  editorCollaborationEnabledAtom,
} from '@/app/components/workflow/editor-resource/state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleQuery } from '@/service/console'
import { useStore, useWorkflowStore } from '../store'
import { ControlMode } from '../types'
import { CommentIcon } from './comment-icon'
import { CommentInput } from './comment-input'
import { getCommentMarkerId } from './marker-id'
import { isSavedAs } from './pending-reply'
import { CommentPlacementPreview } from './placement-preview'
import { CommentThread } from './thread'
import { commentThreadPlacement } from './thread-placement'
import { useRevealComment } from './use-reveal-comment'

const commentsApi = consoleQuery.apps.byAppId.workflow.comments
const replySendKey = commentsApi.byCommentId.replies.post.mutationKey()
const EMPTY_COMMENTS: WorkflowCommentBasic[] = []

// The app's comment list and details; mentionable users do not change with comments.
const refetchComments = (client: QueryClient, appId: string) =>
  Promise.all([
    client.invalidateQueries({
      queryKey: commentsApi.get.key({ input: { params: { app_id: appId } } }),
    }),
    client.invalidateQueries({
      queryKey: commentsApi.byCommentId.get.key({ input: { params: { app_id: appId } } }),
    }),
  ])

// Reconcile the app's comments once the last comment write settles: a refetch while another
// write is still running could undo that write's optimistic state.
const reconcileComments = (client: QueryClient, appId: string) => {
  if (client.isMutating({ mutationKey: commentsApi.key({ type: 'mutation' }) }) > 1) return
  return refetchComments(client, appId)
}

/**
 * The canvas's comments: the composer for a new one, the markers, and the one thread
 * popover every marker triggers. The selected comment decides whether the thread is open
 * and which marker anchors it; the thread keeps showing a comment until it finishes closing.
 */
export function WorkflowCommentLayer() {
  const appId = useAtomValue(editorAppIdAtom)
  const isCollaborationEnabled = useAtomValue(editorCollaborationEnabledAtom)
  const queryClient = useQueryClient()
  const reactflow = useReactFlow()
  const workflowStore = useWorkflowStore()
  const revealComment = useRevealComment()
  const controlMode = useStore((s) => s.controlMode)
  const showUserComments = useStore((s) => s.showUserComments)
  const showResolvedComments = useStore((s) => s.showResolvedComments)
  const pendingComment = useStore((s) => s.pendingComment)
  const activeCommentId = useStore((s) => s.activeCommentId) ?? null
  const setActiveCommentId = useStore((s) => s.setActiveCommentId)
  const [threadHandle] = useState(() => createPopoverHandle())

  const { data: comments = EMPTY_COMMENTS } = useQuery({
    ...commentsApi.get.queryOptions({
      input: appId ? { params: { app_id: appId } } : skipToken,
      enabled: isCollaborationEnabled,
    }),
    select: (list) => list.data,
  })

  // A collaborator's change refetches the comments, unless a write from here is running;
  // that write reconciles once it settles.
  useEffect(() => {
    if (!appId || !isCollaborationEnabled) return
    return collaborationManager.onCommentsUpdate(() => {
      if (queryClient.isMutating({ mutationKey: commentsApi.key({ type: 'mutation' }) }) > 0) return
      void refetchComments(queryClient, appId)
    })
  }, [appId, isCollaborationEnabled, queryClient])

  // A new comment's composer keeps its text until the comment is on the canvas.
  const createComment = useMutation(
    commentsApi.post.mutationOptions({
      onSuccess: (_data, { params }) => collaborationManager.emitCommentsUpdate(params.app_id),
      onSettled: (_data, _error, { params }) => reconcileComments(queryClient, params.app_id),
    }),
  )
  const submitComment = async (content: string, mentionedUserIds: string[]) => {
    if (!pendingComment || !appId) return
    const position = reactflow.screenToFlowPosition({
      x: pendingComment.pageX,
      y: pendingComment.pageY,
    })
    try {
      await createComment.mutateAsync({
        params: { app_id: appId },
        body: {
          position_x: position.x,
          position_y: position.y,
          content,
          mentioned_user_ids: mentionedUserIds,
        },
      })
      workflowStore.setState({ pendingComment: null, isCommentQuickAdd: false })
    } catch (error) {
      console.error('Failed to create comment:', error)
    }
  }

  // Moving a marker shows its new position at once; a failed move puts back the position
  // alone, keeping anything written to the thread meanwhile.
  const moveComment = useMutation(
    commentsApi.byCommentId.put.mutationOptions({
      onMutate: async ({ params, body }) => {
        const listKey = commentsApi.get.queryKey({ input: { params: { app_id: params.app_id } } })
        const detailKey = commentsApi.byCommentId.get.queryKey({ input: { params } })
        await Promise.all([
          queryClient.cancelQueries({ queryKey: listKey }),
          queryClient.cancelQueries({ queryKey: detailKey }),
        ])
        const setPosition = (position_x: number, position_y: number) => {
          queryClient.setQueryData(listKey, (list) =>
            list
              ? {
                  ...list,
                  data: list.data.map((comment) =>
                    comment.id === params.comment_id
                      ? { ...comment, position_x, position_y }
                      : comment,
                  ),
                }
              : list,
          )
          queryClient.setQueryData(detailKey, (detail) =>
            detail ? { ...detail, position_x, position_y } : detail,
          )
        }
        const previous = queryClient
          .getQueryData(listKey)
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
      onSuccess: (_data, { params }) => collaborationManager.emitCommentsUpdate(params.app_id),
      onSettled: (_data, _error, { params }) => reconcileComments(queryClient, params.app_id),
    }),
  )
  const moveCommentTo = (commentId: string, position: { x: number; y: number }) => {
    const comment = comments.find((item) => item.id === commentId)
    if (!appId || !comment) return
    moveComment.mutate({
      params: { app_id: appId, comment_id: commentId },
      body: { content: comment.content, position_x: position.x, position_y: position.y },
    })
  }

  // The comment the thread shows: the selected one, kept after deselection (or deletion)
  // until the thread finishes closing.
  const activeComment = activeCommentId
    ? comments.find((comment) => comment.id === activeCommentId)
    : undefined
  const [shownComment, setShownComment] = useState<WorkflowCommentBasic | null>(null)
  if (activeComment && activeComment !== shownComment) setShownComment(activeComment)

  const visibleComments = useMemo(
    () => (showResolvedComments ? comments : comments.filter((comment) => !comment.resolved)),
    [comments, showResolvedComments],
  )
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
          position={{ x: pendingComment.elementX, y: pendingComment.elementY }}
          onSubmit={submitComment}
          onCancel={() =>
            workflowStore.setState({ pendingComment: null, isCommentQuickAdd: false })
          }
          onPositionChange={(position) => workflowStore.setState({ pendingComment: position })}
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
            workflowStore.setState({ pendingComment: null })
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
          <PopoverPositioner {...commentThreadPlacement}>
            {appId && shownComment && (
              <ShownThread
                appId={appId}
                listItem={shownComment}
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

type ReplySendVariables = {
  params: { app_id: string; comment_id: string }
  body: { content: string; mentioned_user_ids?: string[] }
}

/**
 * The thread for one comment: its detail (the list item stands in until the first load),
 * and every write to it. A reply shows as soon as it is sent, from its send mutation; a
 * failed send stays so it can be sent again or dropped.
 */
function ShownThread({
  appId,
  listItem,
  onPrev,
  onNext,
}: {
  appId: string
  listItem: WorkflowCommentBasic
  onPrev?: () => void
  onNext?: () => void
}) {
  const queryClient = useQueryClient()
  const setActiveCommentId = useStore((s) => s.setActiveCommentId)
  const { data: author } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: ({ profile }) => ({
      id: profile.id,
      name: profile.name,
      email: profile.email,
      avatar_url: profile.avatar_url || profile.avatar || null,
    }),
  })
  const params = { app_id: appId, comment_id: listItem.id }
  const detailQuery = useQuery(
    commentsApi.byCommentId.get.queryOptions({
      input: { params },
      placeholderData: { ...listItem, replies: [], mentions: [] },
    }),
  )
  const emit = () => collaborationManager.emitCommentsUpdate(appId)
  const reconcile = () => reconcileComments(queryClient, appId)
  const updateDetail = (update: (detail: WorkflowCommentDetail) => WorkflowCommentDetail) =>
    queryClient.setQueryData(
      commentsApi.byCommentId.get.queryKey({ input: { params } }),
      (detail) => (detail ? update(detail) : detail),
    )

  // A reply keeps the key of its send row once saved, so the row is not remounted.
  const [sentKeys, setSentKeys] = useState<ReadonlyMap<string, string>>(() => new Map())
  const sendKeyOf = (mutation: Pick<Mutation, 'mutationId'>) => `local-${mutation.mutationId}`
  const sendReply = useMutation(
    commentsApi.byCommentId.replies.post.mutationOptions({
      // A failed send stays until it is sent again or dropped.
      gcTime: Infinity,
      onMutate: () => {
        const cache = queryClient.getMutationCache()
        for (const mutation of cache.findAll({ mutationKey: replySendKey, status: 'success' }))
          cache.remove(mutation)
      },
      // The saved reply takes the send row's place at once, under the same key.
      onSuccess: (reply, variables) => {
        const send = queryClient.getMutationCache().find({
          mutationKey: replySendKey,
          predicate: (mutation) => mutation.state.variables === variables,
        })
        if (send) setSentKeys((keys) => new Map(keys).set(reply.id, sendKeyOf(send)))
        updateDetail((detail) =>
          detail.replies.some((item) => item.id === reply.id)
            ? detail
            : {
                ...detail,
                replies: [
                  ...detail.replies,
                  {
                    id: reply.id,
                    content: variables.body.content,
                    created_at: reply.created_at ?? Math.floor(Date.now() / 1000),
                    created_by: author.id,
                    created_by_account: author,
                  },
                ],
              },
        )
        emit()
      },
      onSettled: reconcile,
    }),
  )
  const unsentReplies = useMutationState({
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
  const findSend = (key: string) =>
    queryClient.getMutationCache().find<unknown, unknown, ReplySendVariables, unknown>({
      mutationKey: replySendKey,
      predicate: (mutation) => sendKeyOf(mutation) === key,
    })

  // A send whose response was lost may be saved already: look first, and only send again
  // a reply the server does not have.
  const retryReply = async (key: string) => {
    const failed = findSend(key)
    const variables = failed?.state.variables
    if (!failed || !variables || failed.state.status !== 'error') return
    const sent = unsentReplies.find((reply) => reply.id === key)
    try {
      const detail = await queryClient.query({
        ...commentsApi.byCommentId.get.queryOptions({ input: { params } }),
        staleTime: 0,
      })
      if (sent && detail.replies.some((reply) => isSavedAs(sent, reply))) {
        queryClient.getMutationCache().remove(failed)
        return
      }
    } catch (error) {
      console.error('Failed to refresh the thread before retrying a reply:', error)
    }
    queryClient.getMutationCache().remove(failed)
    sendReply.mutate(variables)
  }

  const editComment = useMutation(
    commentsApi.byCommentId.put.mutationOptions({
      onSuccess: (_data, { body }) => {
        updateDetail((detail) => ({ ...detail, content: body.content }))
        emit()
      },
      onSettled: reconcile,
    }),
  )
  const editReply = useMutation(
    commentsApi.byCommentId.replies.byReplyId.put.mutationOptions({
      onSuccess: (_data, { params: { reply_id }, body }) => {
        updateDetail((detail) => ({
          ...detail,
          replies: detail.replies.map((reply) =>
            reply.id === reply_id ? { ...reply, content: body.content } : reply,
          ),
        }))
        emit()
      },
      onSettled: reconcile,
    }),
  )
  const deleteReply = useMutation(
    commentsApi.byCommentId.replies.byReplyId.delete.mutationOptions({
      onSuccess: (_data, { params: { reply_id } }) => {
        updateDetail((detail) => ({
          ...detail,
          replies: detail.replies.filter((reply) => reply.id !== reply_id),
          mentions: detail.mentions.filter((mention) => mention.reply_id !== reply_id),
        }))
        emit()
      },
      onSettled: reconcile,
    }),
  )
  const deleteComment = useMutation(
    commentsApi.byCommentId.delete.mutationOptions({
      onSuccess: () => {
        queryClient.setQueryData(
          commentsApi.get.queryKey({ input: { params: { app_id: appId } } }),
          (list) =>
            list ? { ...list, data: list.data.filter((item) => item.id !== listItem.id) } : list,
        )
        // The thread just closes; its detail stays for the closing transition.
        setActiveCommentId(null)
        emit()
      },
      onSettled: reconcile,
    }),
  )
  const resolveComment = useMutation(commentsApi.byCommentId.resolve.post.mutationOptions())

  const detail = detailQuery.data
  const comment = useMemo(() => {
    if (!detail) return null
    const saved = detail.replies.map((reply): ThreadReply => {
      const clientKey = sentKeys.get(reply.id)
      return clientKey ? { ...reply, client_key: clientKey } : reply
    })
    // A send stops showing once its saved reply is here.
    const stillUnsent = unsentReplies.filter(
      (reply) => !saved.some((item) => item.client_key === reply.id || isSavedAs(reply, item)),
    )
    return { ...detail, replies: [...saved, ...stillUnsent] }
  }, [detail, sentKeys, unsentReplies])
  if (!comment) return null

  return (
    <CommentThread
      comment={comment}
      loading={detailQuery.isPlaceholderData}
      replyUpdating={editReply.isPending}
      onResolve={() => resolveComment.mutate({ params }, { onSuccess: emit })}
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
      canGoPrev={!!onPrev}
      canGoNext={!!onNext}
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
