'use client'

import type { FC } from 'react'
import { memo, useEffect, useMemo } from 'react'
import { UserAvatarList } from '@/app/components/base/user-avatar-list'
import type { WorkflowCommentList } from '@/service/workflow-comment'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { useStore } from '../store'

type CommentPreviewProps = {
  comment: WorkflowCommentList
  onClick?: () => void
}

const CommentPreview: FC<CommentPreviewProps> = ({ comment, onClick }) => {
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const setCommentPreviewHovering = useStore(s => s.setCommentPreviewHovering)
  const participants = useMemo(() => {
    const list = comment.participants ?? []
    const author = comment.created_by_account
    if (!author)
      return [...list]
    const rest = list.filter(user => user.id !== author.id)
    return [author, ...rest]
  }, [comment.created_by_account, comment.participants])
  useEffect(() => () => {
    setCommentPreviewHovering(false)
  }, [setCommentPreviewHovering])

  return (
    <div
      className="w-80 cursor-pointer rounded-3xl rounded-bl-[3px] border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-4 shadow-lg backdrop-blur-[10px] transition-colors hover:bg-components-panel-on-panel-item-bg-hover"
      onClick={onClick}
      onMouseEnter={() => setCommentPreviewHovering(true)}
      onMouseLeave={() => setCommentPreviewHovering(false)}
    >
      <div className="mb-3 flex items-center justify-between">
        <UserAvatarList
          users={participants}
          maxVisible={3}
          size={24}
        />
      </div>

      <div className="mb-2 flex items-start">
        <div className="flex min-w-0 items-center gap-2">
          <div className="system-sm-medium truncate text-text-primary">{comment.created_by_account.name}</div>
          <div className="system-2xs-regular shrink-0 text-text-tertiary">
            {formatTimeFromNow(comment.updated_at * 1000)}
          </div>
        </div>
      </div>

      <div className="system-sm-regular break-words text-text-secondary">{comment.content}</div>
    </div>
  )
}

export default memo(CommentPreview)
