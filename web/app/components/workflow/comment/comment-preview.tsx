'use client'

import type { FC } from 'react'
import { memo } from 'react'
import { UserAvatarList } from '@/app/components/base/user-avatar-list'
import type { WorkflowCommentList } from '@/service/workflow-comment'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'

type CommentPreviewProps = {
  comment: WorkflowCommentList
  onClick?: () => void
}

const CommentPreview: FC<CommentPreviewProps> = ({ comment, onClick }) => {
  const { formatTimeFromNow } = useFormatTimeFromNow()

  return (
    <div
      className="w-80 cursor-pointer rounded-br-xl rounded-tl-xl rounded-tr-xl border border-components-panel-border bg-components-panel-bg p-4 shadow-lg transition-colors hover:bg-components-panel-on-panel-item-bg-hover"
      onClick={onClick}
    >
      <div className="mb-3 flex items-center justify-between">
        <UserAvatarList
          users={comment.participants}
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
