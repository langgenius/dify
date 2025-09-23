'use client'

import type { FC } from 'react'
import { memo, useMemo } from 'react'
import { useReactFlow, useViewport } from 'reactflow'
import { UserAvatarList } from '@/app/components/base/user-avatar-list'
import type { WorkflowCommentList } from '@/service/workflow-comment'

type CommentIconProps = {
  comment: WorkflowCommentList
  onClick: () => void
}

export const CommentIcon: FC<CommentIconProps> = memo(({ comment, onClick }) => {
  const { flowToScreenPosition } = useReactFlow()
  const viewport = useViewport()

  const screenPosition = useMemo(() => {
    return flowToScreenPosition({
      x: comment.position_x,
      y: comment.position_y,
    })
  }, [comment.position_x, comment.position_y, viewport.x, viewport.y, viewport.zoom, flowToScreenPosition])

  // Calculate dynamic width based on number of participants
  const participantCount = comment.participants?.length || 0
  const maxVisible = Math.min(3, participantCount)
  const showCount = participantCount > 3
  const avatarSize = 24
  const avatarSpacing = 4 // -space-x-1 is about 4px overlap

  // Width calculation: first avatar + (additional avatars * (size - spacing)) + padding
  const dynamicWidth = Math.max(40, // minimum width
    8 + avatarSize + Math.max(0, (showCount ? 2 : maxVisible - 1)) * (avatarSize - avatarSpacing) + 8,
  )

  return (
    <div
      className="absolute z-10 cursor-pointer"
      style={{
        left: screenPosition.x,
        top: screenPosition.y,
        transform: 'translate(-50%, -50%)',
      }}
      onClick={onClick}
    >
      <div
        className={'relative h-10 overflow-hidden rounded-br-full rounded-tl-full rounded-tr-full'}
        style={{ width: dynamicWidth }}
      >
        <div className="absolute inset-[6px] overflow-hidden rounded-br-full rounded-tl-full rounded-tr-full bg-white">
          <div className="flex h-full w-full items-center justify-center px-1">
            <UserAvatarList
              users={comment.participants}
              maxVisible={3}
              size={24}
            />
          </div>
        </div>
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  return (
    prevProps.comment.id === nextProps.comment.id
    && prevProps.comment.position_x === nextProps.comment.position_x
    && prevProps.comment.position_y === nextProps.comment.position_y
    && prevProps.onClick === nextProps.onClick
  )
})

CommentIcon.displayName = 'CommentIcon'
