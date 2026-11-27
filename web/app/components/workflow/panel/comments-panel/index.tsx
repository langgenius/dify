import type { WorkflowCommentBasic } from '@dify/contracts/api/console/apps/types.gen'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { Separator } from '@langgenius/dify-ui/separator'
import { Switch } from '@langgenius/dify-ui/switch'
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CollaboratorAvatarStack } from '@/app/components/workflow/collaboration/components/collaborator-avatar'
import { prefetchCommentThread } from '@/app/components/workflow/comment/comment-prefetch'
import { isWritingComments } from '@/app/components/workflow/comment/comment-writes'
import { getCommentParticipants } from '@/app/components/workflow/comment/participants'
import { useRevealComment } from '@/app/components/workflow/comment/use-reveal-comment'
import {
  editorAppIdAtom,
  editorCollaborationEnabledAtom,
} from '@/app/components/workflow/editor-resource/state'
import { useStore } from '@/app/components/workflow/store'
import { ControlMode } from '@/app/components/workflow/types'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'

type CommentFilter = 'all' | 'mine'

const EMPTY_COMMENTS: WorkflowCommentBasic[] = []

const CommentsPanel = () => {
  const { t } = useTranslation(['common', 'workflowComments', 'workflow'])
  const activeCommentId = useStore((s) => s.activeCommentId)
  const setActiveCommentId = useStore((s) => s.setActiveCommentId)
  const setControlMode = useStore((s) => s.setControlMode)
  const showResolvedComments = useStore((s) => s.showResolvedComments)
  const setShowResolvedComments = useStore((s) => s.setShowResolvedComments)
  const appId = useAtomValue(editorAppIdAtom)
  const isCollaborationEnabled = useAtomValue(editorCollaborationEnabledAtom)
  const queryClient = useQueryClient()
  // Not read again on mount while a comment write to the app is running; the canvas reconciles
  // after it.
  const commentsQuery = useQuery({
    ...consoleQuery.apps.byAppId.workflow.comments.get.queryOptions({
      input: isCollaborationEnabled && appId ? { params: { app_id: appId } } : skipToken,
      staleTime: () => (appId && isWritingComments(queryClient, appId) ? Infinity : 0),
    }),
    select: (list) => list.data,
  })
  const comments = commentsQuery.data ?? EMPTY_COMMENTS
  const loading = commentsQuery.isLoading
  const commentsLoad = useOwnedQueryError(commentsQuery)
  const loadErrorMessage = useRequestErrorMessage(
    commentsLoad?.error,
    t(($) => $['common.loadFailed'], { ns: 'workflow' }),
  )
  const resolveComment = useMutation(
    consoleQuery.apps.byAppId.workflow.comments.byCommentId.resolve.post.mutationOptions(),
  )
  const revealComment = useRevealComment()
  const { formatTimeFromNow } = useFormatTimeFromNow()

  const [showOnlyMine, setShowOnlyMine] = useState(false)

  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),

    select: (data) => data.profile.id,
  })

  const filteredSorted = useMemo(() => {
    let data = comments
    if (!showResolvedComments) data = data.filter((c) => !c.resolved)
    if (showOnlyMine) data = data.filter((c) => c.created_by === currentUserId)
    return data
  }, [comments, currentUserId, showOnlyMine, showResolvedComments])

  // Resolving leaves the selection alone; the user may have opened another thread since.
  const handleResolve = (comment: WorkflowCommentBasic) => {
    if (comment.resolved || !appId) return
    resolveComment.mutate({ params: { app_id: appId, comment_id: comment.id } })
  }

  const hasActiveFilter = showOnlyMine || showResolvedComments

  return (
    <div className="relative flex h-full w-105 flex-col overflow-hidden rounded-s-2xl border border-components-panel-border bg-chatbot-bg shadow-xl backdrop-blur-[5px]">
      <div className="flex shrink-0 items-center gap-2 border-b-[0.5px] border-divider-regular bg-background-gradient-bg-fill-chat-bg-1 px-4 py-3">
        <div className="min-w-0 grow truncate system-xl-semibold text-text-primary">
          {t(($) => $['comments.panelTitle'], { ns: 'workflowComments' })}
        </div>
        <Menu>
          <MenuTrigger
            render={
              <IconButton
                variant={hasActiveFilter ? 'ghost-accent' : 'default'}
                className={
                  hasActiveFilter
                    ? 'bg-state-accent-active data-popup-open:bg-state-accent-hover'
                    : 'data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary'
                }
                aria-label={t(($) => $['comments.aria.filterComments'], {
                  ns: 'workflowComments',
                })}
              >
                <span aria-hidden className="i-ri-filter-3-line size-4" />
              </IconButton>
            }
          />
          <MenuContent align="end" alignOffset={-57} sideOffset={4} className="min-w-46">
            <MenuRadioGroup<CommentFilter>
              value={showOnlyMine ? 'mine' : 'all'}
              onValueChange={(value) => setShowOnlyMine(value === 'mine')}
            >
              <MenuRadioItem<CommentFilter> value="all" closeOnClick>
                {t(($) => $['comments.filter.all'], { ns: 'workflowComments' })}
                <MenuRadioItemIndicator />
              </MenuRadioItem>
              <MenuRadioItem<CommentFilter> value="mine" closeOnClick>
                {t(($) => $['comments.filter.onlyYourThreads'], { ns: 'workflowComments' })}
                <MenuRadioItemIndicator />
              </MenuRadioItem>
            </MenuRadioGroup>
            <MenuSeparator />
            <MenuCheckboxItem
              checked={showResolvedComments}
              closeOnClick={false}
              className="justify-between"
              onCheckedChange={setShowResolvedComments}
            >
              {t(($) => $['comments.filter.showResolved'], { ns: 'workflowComments' })}
              {/* The item owns the checkbox semantics; the switch only shows its state. */}
              <Switch
                checked={showResolvedComments}
                readOnly
                aria-hidden="true"
                tabIndex={-1}
                className="pointer-events-none"
              />
            </MenuCheckboxItem>
          </MenuContent>
        </Menu>
        <Separator decorative orientation="vertical" className="mx-1 h-3.5" />
        <IconButton
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          onClick={() => {
            setControlMode(ControlMode.Pointer)
            setActiveCommentId(null)
          }}
        >
          <span aria-hidden className="i-ri-close-line size-4" />
        </IconButton>
      </div>
      {commentsLoad ? (
        <div className="p-3">
          <Alert type="error">
            <AlertTitle>{loadErrorMessage}</AlertTitle>
            <AlertActions>
              <Button
                size="small"
                variant="secondary"
                loading={commentsLoad.retrying}
                onClick={commentsLoad.retry}
              >
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </Button>
            </AlertActions>
          </Alert>
        </div>
      ) : !loading && filteredSorted.length === 0 ? (
        <div className="flex grow flex-col items-center justify-center gap-2 p-3 pb-30 text-center">
          <span
            aria-hidden
            className="i-custom-vender-line-communication-bubble-text size-8 text-text-quaternary"
          />
          <div className="flex flex-col gap-1">
            <div className="system-md-medium text-text-secondary">
              {t(($) => $['comments.panelTitle'], { ns: 'workflowComments' })}
            </div>
            <div className="system-xs-regular text-text-tertiary">
              {t(($) => $['comments.emptyDescription'], { ns: 'workflowComments' })}
            </div>
          </div>
        </div>
      ) : (
        <div className="grow overflow-y-auto p-1">
          {filteredSorted.map((c) => (
            <div
              key={c.id}
              data-active={activeCommentId === c.id ? '' : undefined}
              className="group relative flex cursor-pointer flex-col gap-2 rounded-lg py-3 ps-3.5 pe-3 transition-colors hover:bg-state-base-hover data-active:bg-state-base-hover"
              onClick={() => revealComment(c)}
              onPointerEnter={() => {
                if (appId) prefetchCommentThread(queryClient, { app_id: appId, comment_id: c.id })
              }}
            >
              <CollaboratorAvatarStack collaborators={getCommentParticipants(c)} />
              <div className="absolute end-3 top-3 flex items-center gap-1">
                {c.resolved ? (
                  <span aria-hidden className="flex size-6 items-center justify-center">
                    <span className="i-ri-checkbox-circle-fill size-4 text-text-tertiary" />
                  </span>
                ) : (
                  <IconButton
                    className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 group-data-active:opacity-100 [@media(hover:none)]:opacity-100"
                    aria-label={t(($) => $['comments.aria.resolveComment'], {
                      ns: 'workflowComments',
                    })}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleResolve(c)
                    }}
                  >
                    <span aria-hidden className="i-ri-checkbox-circle-line size-4" />
                  </IconButton>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex min-w-0 items-center gap-1">
                  <div className="truncate system-sm-medium text-text-primary">
                    {c.created_by_account?.name ?? ''}
                  </div>
                  <div className="shrink-0 system-xs-regular text-text-tertiary">
                    {formatTimeFromNow((c.updated_at ?? c.created_at ?? 0) * 1000)}
                  </div>
                </div>
                <div className="line-clamp-3 body-sm-regular leading-4.5 wrap-break-word text-text-secondary">
                  {c.content}
                </div>
                {c.reply_count > 0 && (
                  <div className="system-xs-regular text-text-tertiary">
                    {t(($) => $['comments.replyCount'], {
                      ns: 'workflowComments',
                      count: c.reply_count,
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default memo(CommentsPanel)
