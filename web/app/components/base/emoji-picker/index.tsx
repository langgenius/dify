'use client'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Separator } from '@langgenius/dify-ui/separator'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { defaultEmojiBackground, getRandomEmoji, getRandomEmojiBackground } from './constants'
import EmojiPickerInner from './Inner'
import { addRecentEmoji, useRecentEmojis } from './storage'

type EmojiPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect?: (emoji: string, background: string) => void
  className?: string
}

function EmojiPicker({ open, onOpenChange, onSelect, className }: EmojiPickerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <EmojiPickerContent className={className} onOpenChange={onOpenChange} onSelect={onSelect} />
      ) : null}
    </Dialog>
  )
}

type EmojiPickerContentProps = {
  className?: string
  onOpenChange: (open: boolean) => void
  onSelect?: (emoji: string, background: string) => void
}

function EmojiPickerContent({ className, onOpenChange, onSelect }: EmojiPickerContentProps) {
  const { t } = useTranslation()
  const [selectedEmoji, setSelectedEmoji] = useState('')
  const [selectedBackground, setSelectedBackground] = useState(defaultEmojiBackground)
  const [, setRecentEmojis] = useRecentEmojis()

  return (
    <DialogContent
      className={cn(
        'flex h-[min(480px,calc(100dvh-2rem))] max-h-none w-80.5 flex-col overflow-hidden p-0 text-left',
        className,
      )}
    >
      <DialogTitle className="sr-only">
        {t(($) => $['iconPicker.emoji'], { ns: 'app' })}
      </DialogTitle>

      <EmojiPickerInner
        className="flex-1 overflow-hidden pt-3"
        emoji={selectedEmoji}
        background={selectedBackground}
        onSelect={(emoji, background) => {
          setSelectedEmoji(emoji)
          setSelectedBackground(background)
        }}
      />
      <Separator decorative className="m-0 h-[0.5px]" />
      <div className="flex w-full shrink-0 items-center justify-center gap-2 bg-components-panel-bg-blur p-3 backdrop-blur-sm">
        <Button
          className="min-w-0 flex-1"
          onClick={() => {
            setSelectedEmoji(getRandomEmoji(selectedEmoji))
            setSelectedBackground(getRandomEmojiBackground(selectedBackground))
          }}
        >
          <span className="i-ri-dice-line size-4" aria-hidden="true" />
          {t(($) => $['iconPicker.tryYourLuck'], { ns: 'app' })}
        </Button>
        <Button
          disabled={selectedEmoji === '' || !selectedBackground}
          variant="primary"
          className="min-w-0 flex-1"
          onClick={() => {
            setRecentEmojis((recent) => addRecentEmoji(recent, selectedEmoji))
            onSelect?.(selectedEmoji, selectedBackground)
            onOpenChange(false)
          }}
        >
          {t(($) => $['iconPicker.ok'], { ns: 'app' })}
        </Button>
      </div>
    </DialogContent>
  )
}
export default EmojiPicker
