'use client'

import type { WorkflowCommentBasic } from '@dify/contracts/api/console/apps/types.gen'
import type { FC } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { memo, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { editorAppIdAtom } from '@/app/components/workflow/editor-resource/state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { CollaboratorAvatarStack } from '../collaboration/components/collaborator-avatar'
import { useStore } from '../store'
import { highlightMentions } from './mention-highlight'
import { getCommentParticipants } from './participants'

type CommentPreviewProps = {
  comment: WorkflowCommentBasic
  onClick?: () => void
}

const CommentPreview: FC<CommentPreviewProps> = ({ comment, onClick }) => {
  const { t } = useTranslation(['workflowComments'])
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const appId = useAtomValue(editorAppIdAtom)
  const mentionUsers = useStore((s) => (appId ? s.mentionableUsersCache[appId] : undefined))
  const mentionNames = useMemo(
    () => (mentionUsers ?? []).map((user) => user.name).filter(Boolean),
    [mentionUsers],
  )
  const setCommentPreviewHovering = useStore((s) => s.setCommentPreviewHovering)
  const authorName = comment.created_by_account?.name ?? ''
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const participants = useMemo(
    () => getCommentParticipants(comment, currentUserId),
    [comment, currentUserId],
  )
  useEffect(
    () => () => {
      setCommentPreviewHovering(false)
    },
    [setCommentPreviewHovering],
  )

  return (
    <div
      className="flex w-70 cursor-pointer flex-col gap-2 rounded-3xl rounded-es-[3px] border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-4 shadow-lg backdrop-blur-[5px] transition-colors hover:bg-components-panel-on-panel-item-bg-hover"
      onClick={onClick}
      onMouseEnter={() => setCommentPreviewHovering(true)}
      onMouseLeave={() => setCommentPreviewHovering(false)}
    >
      <CollaboratorAvatarStack collaborators={participants} />
      <div className="flex flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1">
          <div className="truncate system-xs-medium text-text-primary">{authorName}</div>
          <div className="shrink-0 system-xs-regular text-text-tertiary">
            {formatTimeFromNow((comment.updated_at ?? comment.created_at ?? 0) * 1000)}
          </div>
        </div>
        <div className="system-xs-regular wrap-break-word text-text-secondary">
          {highlightMentions(comment.content, mentionNames)}
        </div>
        {comment.reply_count > 0 && (
          <div className="system-2xs-regular text-text-tertiary">
            {t(($) => $['comments.replyCount'], {
              ns: 'workflowComments',
              count: comment.reply_count,
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(CommentPreview)
