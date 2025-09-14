import type { FC } from 'react'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
