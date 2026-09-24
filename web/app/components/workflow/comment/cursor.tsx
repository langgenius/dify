import type { FC } from 'react'
import { memo } from 'react'
import { useStore } from '../store'
import { ControlMode } from '../types'

export const CommentCursor: FC = memo(() => {
  const controlMode = useStore((s) => s.controlMode)
  const mousePosition = useStore((s) => s.mousePosition)
  const isCommentPlacing = useStore((s) => s.isCommentPlacing)

  if (controlMode !== ControlMode.Comment || isCommentPlacing) return null

  return (
    <div
      className="pointer-events-none absolute z-30 flex size-6 items-center justify-center"
      style={{
        left: mousePosition.elementX,
        top: mousePosition.elementY,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <span aria-hidden className="i-custom-public-other-comment h-3 w-3.5 text-text-primary" />
    </div>
  )
})

CommentCursor.displayName = 'CommentCursor'
