import type { FC } from 'react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useReactFlow, useViewport } from 'reactflow'
import Avatar from '@/app/components/base/avatar'
import { useAppContext } from '@/context/app-context'
import { MentionInput } from './mention-input'
import cn from '@/utils/classnames'

type CommentInputProps = {
  position: { x: number; y: number }
  onSubmit: (content: string, mentionedUserIds: string[]) => void
  onCancel: () => void
}

export const CommentInput: FC<CommentInputProps> = memo(({ position, onSubmit, onCancel }) => {
  const [content, setContent] = useState('')
  const { userProfile } = useAppContext()
  const { flowToScreenPosition } = useReactFlow()
  const viewport = useViewport()

  const screenPosition = useMemo(() => {
    return flowToScreenPosition(position)
  }, [position.x, position.y, viewport.x, viewport.y, viewport.zoom, flowToScreenPosition])

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }
    }

    document.addEventListener('keydown', handleGlobalKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown, true)
    }
  }, [onCancel])

  const handleMentionSubmit = useCallback((content: string, mentionedUserIds: string[]) => {
    onSubmit(content, mentionedUserIds)
    setContent('')
  }, [onSubmit])

  return (
    <div
      className="absolute z-50 w-96"
      style={{
        left: screenPosition.x,
        top: screenPosition.y,
      }}
      data-comment-input
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <div className="relative h-14 w-14 overflow-hidden rounded-br-full rounded-tl-full rounded-tr-full bg-primary-500">
            <div className="absolute inset-1 overflow-hidden rounded-br-full rounded-tl-full rounded-tr-full bg-white">
              <div className="flex h-full w-full items-center justify-center">
                <div className="h-10 w-10 overflow-hidden rounded-full">
                  <Avatar
                    avatar={userProfile.avatar_url}
                    name={userProfile.name}
                    size={40}
                    className="h-full w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div
          className={cn(
            'relative z-10 flex-1 rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur pb-[9px] shadow-md',
          )}
        >
          <div className='relative px-[9px] pt-[9px]'>
            <MentionInput
              value={content}
              onChange={setContent}
              onSubmit={handleMentionSubmit}
              placeholder="Add a comment"
              autoFocus
              minRows={1}
              maxRows={4}
              className="relative"
            />
          </div>
        </div>
      </div>
    </div>
  )
})

CommentInput.displayName = 'CommentInput'
