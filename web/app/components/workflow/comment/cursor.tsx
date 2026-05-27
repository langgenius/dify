import type { FC } from 'react'
import type { PointerPosition } from '../utils/pointer-position'
import { memo } from 'react'
import { Comment } from '@/app/components/base/icons/src/public/other'
import { useStore } from '../store'
import { ControlMode } from '../types'

type CommentCursorProps = {
  position: PointerPosition
}

export const CommentCursor: FC<CommentCursorProps> = memo(({
  position,
}) => {
  const controlMode = useStore(s => s.controlMode)
  const isCommentPlacing = useStore(s => s.isCommentPlacing)

  if (controlMode !== ControlMode.Comment || isCommentPlacing)
    return null

  return (
    <div
      className="pointer-events-none absolute z-50 flex size-6 items-center justify-center"
      style={{
        left: position.elementX,
        top: position.elementY,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <Comment className="text-text-primary" />
    </div>
  )
})

CommentCursor.displayName = 'CommentCursor'
