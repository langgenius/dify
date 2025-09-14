import type { FC } from 'react'
import { memo } from 'react'
import type { WorkflowComment } from '@/service/workflow-comment'

type CommentIconProps = {
  comment: WorkflowComment
  onClick: () => void
}

export const CommentIcon: FC<CommentIconProps> = memo(({ comment, onClick }) => {
  return (
    <div
      className="absolute z-40 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-blue-500 text-white shadow-lg hover:bg-blue-600"
      style={{
        left: comment.position_x,
        top: comment.position_y,
        transform: 'translate(-50%, -50%)',
      }}
      onClick={onClick}
    >
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-medium text-blue-500">
        {'A'}
      </div>
    </div>
  )
})

CommentIcon.displayName = 'CommentIcon'
