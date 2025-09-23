import type { FC } from 'react'
import { memo } from 'react'
import { useStore } from '../store'
import { ControlMode } from '../types'
import { Comment } from '@/app/components/base/icons/src/public/other'

type CommentCursorProps = {
  mousePosition: { elementX: number; elementY: number }
}

export const CommentCursor: FC<CommentCursorProps> = memo(({ mousePosition }) => {
  const controlMode = useStore(s => s.controlMode)

  if (controlMode !== ControlMode.Comment)
    return null

  return (
    <div
      className="pointer-events-none absolute z-50 flex h-6 w-6 items-center justify-center"
      style={{
        left: mousePosition.elementX,
        top: mousePosition.elementY,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <Comment />
    </div>
  )
})

CommentCursor.displayName = 'CommentCursor'
