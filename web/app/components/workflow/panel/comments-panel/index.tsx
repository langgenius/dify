import type { WorkflowCommentBasic } from '@dify/contracts/api/console/apps/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
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
import { RiCheckboxCircleFill, RiCheckboxCircleLine } from '@remixicon/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UserAvatarList } from '@/app/components/base/user-avatar-list'
import { useStore } from '@/app/components/workflow/store'
import { ControlMode } from '@/app/components/workflow/types'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { useWorkflowComment } from '../../hooks/use-workflow-comment'

type CommentFilter = 'all' | 'mine'

const CommentsPanel = () => {
  const { t } = useTranslation(['common', 'workflowComments'])
  const activeCommentId = useStore((s) => s.activeCommentId)
  const setActiveCommentId = useStore((s) => s.setActiveCommentId)
  const setControlMode = useStore((s) => s.setControlMode)
  const showResolvedComments = useStore((s) => s.showResolvedComments)
  const setShowResolvedComments = useStore((s) => s.setShowResolvedComments)
  const { comments, loading, handleCommentReveal, handleCommentResolve } = useWorkflowComment()
  const { formatTimeFromNow } = useFormatTimeFromNow()

  const [showOnlyMine, setShowOnlyMine] = useState(false)

  const handleSelect = useCallback(
    (comment: WorkflowCommentBasic) => {
      handleCommentReveal(comment)
    },
    [handleCommentReveal],
  )

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

  const handleResolve = useCallback(
    async (comment: WorkflowCommentBasic) => {
      if (comment.resolved) return
      try {
        await handleCommentResolve(comment.id)
        setActiveCommentId(comment.id)
      } catch (e) {
        console.error('Resolve comment failed', e)
      }
    },
    [handleCommentResolve, setActiveCommentId],
  )

  const hasActiveFilter = showOnlyMine || !showResolvedComments

  return (
    <div
      className={cn(
        'relative flex h-full w-105 flex-col rounded-s-2xl border border-components-panel-border bg-components-panel-bg',
      )}
    >
      <div className="flex items-center justify-between p-4 pb-2">
        <div className="system-xl-semibold leading-6 font-semibold text-text-primary">
          {t(($) => $['comments.panelTitle'], { ns: 'workflowComments' })}
        </div>
        <div className="flex items-center gap-2">
          <Menu>
            <MenuTrigger
              render={
                <IconButton
                  variant={hasActiveFilter ? 'ghost-accent' : 'default'}
                  aria-label={t(($) => $['comments.aria.filterComments'], {
                    ns: 'workflowComments',
                  })}
                >
                  <span aria-hidden className="i-ri-filter-3-line size-4" />
                </IconButton>
              }
            />
            <MenuContent align="end">
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
          <Separator decorative orientation="vertical" className="mx-2 h-3.5" />
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
      </div>
      <div className="grow overflow-y-auto px-1">
        {filteredSorted.map((c) => {
          const isActive = activeCommentId === c.id
          return (
            <div
              key={c.id}
              className={cn(
                'group mb-2 cursor-pointer rounded-xl bg-components-panel-bg p-3 transition-colors hover:bg-components-panel-on-panel-item-bg-hover',
                isActive && 'bg-components-panel-on-panel-item-bg-hover',
              )}
              onClick={() => handleSelect(c)}
            >
              <div className="min-w-0">
                <div className="mb-1 flex items-center justify-between">
                  <UserAvatarList users={c.participants} maxVisible={3} size="sm" />
                  <div className="ms-2 flex items-center">
                    {c.resolved ? (
                      <RiCheckboxCircleFill className="size-4 text-text-secondary" />
                    ) : (
                      <RiCheckboxCircleLine
                        className="size-4 cursor-pointer text-text-tertiary hover:text-text-secondary"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          handleResolve(c)
                        }}
                      />
                    )}
                  </div>
                </div>
                {/* Header row: creator + time */}
                <div className="flex items-start">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="truncate system-sm-medium text-text-primary">
                      {c.created_by_account?.name ?? ''}
                    </div>
                    <div className="shrink-0 system-2xs-regular text-text-tertiary">
                      {formatTimeFromNow((c.updated_at ?? c.created_at ?? 0) * 1000)}
                    </div>
                  </div>
                </div>
                {/* Content */}
                <div className="mt-1 line-clamp-3 system-sm-regular wrap-break-word text-text-secondary">
                  {c.content}
                </div>
                {/* Footer */}
                {c.reply_count > 0 && (
                  <div className="mt-2 flex items-center justify-between">
                    <div className="system-2xs-regular text-text-tertiary">
                      {t(($) => $['comments.replyCount'], {
                        ns: 'workflowComments',
                        count: c.reply_count,
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {!loading && filteredSorted.length === 0 && (
          <div className="mt-6 text-center system-sm-regular text-text-tertiary">
            {t(($) => $['comments.noComments'], { ns: 'workflowComments' })}
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(CommentsPanel)
