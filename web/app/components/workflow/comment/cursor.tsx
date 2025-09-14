import type { FC } from 'react'
import { memo } from 'react'
import { useStore } from '../store'
import { ControlMode } from '../types'

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
        left: mousePosition.elementX - 3,
        top: mousePosition.elementY - 3,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M10.5 6.33325H5.5H10.5ZM8 9.66658H5.5H8ZM0.5 14.6666H11.3333C13.6345 14.6666 15.5 12.8011 15.5 10.4999V5.49992C15.5 3.19874 13.6345 1.33325 11.3333 1.33325H4.66667C2.36548 1.33325 0.5 3.19874 0.5 5.49992V14.6666Z" fill="white"/>
        <path d="M10.5 6.33325H5.5M8 9.66658H5.5M0.5 14.6666H11.3333C13.6345 14.6666 15.5 12.8011 15.5 10.4999V5.49992C15.5 3.19874 13.6345 1.33325 11.3333 1.33325H4.66667C2.36548 1.33325 0.5 3.19874 0.5 5.49992V14.6666Z" stroke="black"/>
      </svg>
    </div>
  )
})

CommentCursor.displayName = 'CommentCursor'
