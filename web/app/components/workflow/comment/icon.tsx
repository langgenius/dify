import type { FC } from 'react'
import { memo, useMemo } from 'react'
import { useReactFlow, useViewport } from 'reactflow'
import Avatar from '@/app/components/base/avatar'
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
      <div className="relative h-10 w-10 overflow-hidden rounded-br-full rounded-tl-full rounded-tr-full">
        <div className="absolute inset-1 overflow-hidden rounded-br-full rounded-tl-full rounded-tr-full bg-white">
          <div className="flex h-full w-full items-center justify-center">
            <div className="h-6 w-6 overflow-hidden rounded-full">
              <Avatar
                avatar={comment.created_by_account.avatar_url || null}
                name={comment.created_by_account.name}
                size={24}
                className="h-full w-full"
              />
            </div>
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
