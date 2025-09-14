import type { FC } from 'react'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'
import { ControlMode } from '../types'
import type { WorkflowComment } from '@/service/workflow-comment'

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

type CommentInputProps = {
  position: { x: number; y: number }
  onSubmit: (content: string) => void
  onCancel: () => void
}

export const CommentInput: FC<CommentInputProps> = memo(({ position, onSubmit, onCancel }) => {
  const { t } = useTranslation()
  const [content, setContent] = useState('')

  const handleSubmit = useCallback(() => {
    try {
      if (content.trim()) {
        onSubmit(content.trim())
        setContent('')
      }
    }
 catch (error) {
      console.error('Error in CommentInput handleSubmit:', error)
    }
  }, [content, onSubmit])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
 else if (e.key === 'Escape') {
      onCancel()
    }
  }, [handleSubmit, onCancel])

  return (
    <div
      className="absolute z-50 w-64 rounded-lg border bg-white shadow-lg"
      style={{
        left: position.x + 10,
        top: position.y + 10,
      }}
    >
      <textarea
        autoFocus
        value={content}
        onChange={e => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add comment..."
        className="w-full resize-none rounded-t-lg border-0 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        rows={3}
      />
      <div className="flex justify-end gap-2 border-t bg-gray-50 p-2">
        <button
          onClick={onCancel}
          className="rounded px-3 py-1 text-sm text-gray-500 hover:bg-gray-100"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!content.trim()}
          className="rounded bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600 disabled:bg-gray-300"
        >
          Submit
        </button>
      </div>
    </div>
  )
})

CommentInput.displayName = 'CommentInput'

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
        TEST
      </div>
    </div>
  )
})

CommentIcon.displayName = 'CommentIcon'
