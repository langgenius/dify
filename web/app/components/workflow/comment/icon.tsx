import type { FC } from 'react'
import { memo } from 'react'
import Avatar from '@/app/components/base/avatar'
import type { WorkflowCommentList } from '@/service/workflow-comment'

type CommentIconProps = {
  comment: WorkflowCommentList
  onClick: () => void
}

export const CommentIcon: FC<CommentIconProps> = memo(({ comment, onClick }) => {
  return (
    <div
      className="absolute z-40 cursor-pointer"
      style={{
        left: comment.position_x,
        top: comment.position_y,
        transform: 'translate(-50%, -50%)',
      }}
      onClick={onClick}
    >
      <div className="relative h-14 w-14 overflow-hidden rounded-br-full rounded-tl-full rounded-tr-full">
        <div className="absolute inset-1 overflow-hidden rounded-br-full rounded-tl-full rounded-tr-full bg-white">
          <div className="flex h-full w-full items-center justify-center">
            <div className="h-10 w-10 overflow-hidden rounded-full">
              <Avatar
                avatar={comment.created_by_account.avatar_url}
                name={comment.created_by_account.name}
                size={40}
                className="h-full w-full"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})

CommentIcon.displayName = 'CommentIcon'
