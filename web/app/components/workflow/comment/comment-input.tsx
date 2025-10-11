import type { FC } from 'react'
import { memo, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const { userProfile } = useAppContext()

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
      className="absolute z-[60] w-96"
      style={{
        left: position.x,
        top: position.y,
      }}
      data-comment-input
    >
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <div className="relative h-8 w-8 overflow-hidden rounded-br-full rounded-tl-full rounded-tr-full bg-primary-500">
            <div className="absolute inset-[2px] overflow-hidden rounded-br-full rounded-tl-full rounded-tr-full bg-white">
              <div className="flex h-full w-full items-center justify-center">
                <div className="h-6 w-6 overflow-hidden rounded-full">
                  <Avatar
                    avatar={userProfile.avatar_url}
                    name={userProfile.name}
                    size={24}
                    className="h-full w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div
          className={cn(
            'relative z-10 flex-1 rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur pb-[4px] shadow-md',
          )}
        >
          <div className='relative px-[9px] pt-[4px]'>
            <MentionInput
              value={content}
              onChange={setContent}
              onSubmit={handleMentionSubmit}
              placeholder={t('workflow.comments.placeholder.add')}
              autoFocus
              className="relative"
            />
          </div>
        </div>
      </div>
    </div>
  )
})

CommentInput.displayName = 'CommentInput'
