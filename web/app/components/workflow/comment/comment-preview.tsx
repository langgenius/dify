'use client'

import type { WorkflowCommentBasic } from '@dify/contracts/api/console/apps/types.gen'
import type { FC } from 'react'
import { memo, useEffect, useMemo } from 'react'
import { UserAvatarList } from '@/app/components/base/user-avatar-list'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { useStore } from '../store'

type CommentPreviewProps = {
  comment: WorkflowCommentBasic
  onClick?: () => void
}

const CommentPreview: FC<CommentPreviewProps> = ({ comment, onClick }) => {
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const setCommentPreviewHovering = useStore((s) => s.setCommentPreviewHovering)
  const authorName = comment.created_by_account?.name ?? ''
  const participants = useMemo(() => {
    const list = comment.participants ?? []
    const author = comment.created_by_account
    if (!author) return [...list]
    const rest = list.filter((user) => user.id !== author.id)
    return [author, ...rest]
  }, [comment.created_by_account, comment.participants])
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
      <UserAvatarList users={participants} maxVisible={3} size="sm" />
      <div className="flex flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1">
          <div className="truncate system-xs-medium text-text-primary">{authorName}</div>
          <div className="shrink-0 system-xs-regular text-text-tertiary">
            {formatTimeFromNow((comment.updated_at ?? comment.created_at ?? 0) * 1000)}
          </div>
        </div>
        <div className="system-xs-regular wrap-break-word text-text-secondary">
          {comment.content}
        </div>
      </div>
    </div>
  )
}

export default memo(CommentPreview)
