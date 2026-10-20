import { useHotkey } from '@tanstack/react-hotkeys'
import { useStore } from '../store/workflow'
import { CommentInput } from './comment-input'

export function CommentPlacementPreview({
  onSubmit,
  onCancel,
}: {
  onSubmit: (content: string, mentionedUserIds: string[]) => void
  onCancel: () => void
}) {
  const isCommentPlacing = useStore((state) => state.isCommentPlacing)
  const pendingComment = useStore((state) => state.pendingComment)
  const mousePosition = useStore((state) => state.mousePosition)
  const placing = isCommentPlacing && !pendingComment

  useHotkey(
    'Escape',
    (event) => {
      if (event.defaultPrevented || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return
      onCancel()
    },
    {
      enabled: placing,
      ignoreInputs: true,
      preventDefault: false,
      stopPropagation: false,
    },
  )

  if (!placing) return null

  return (
    <CommentInput
      position={{ x: mousePosition.elementX, y: mousePosition.elementY }}
      onSubmit={onSubmit}
      onCancel={onCancel}
      autoFocus={false}
      disabled
    />
  )
}
