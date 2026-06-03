'use client'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import EmojiPickerInner from './Inner'

type EmojiPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect?: (emoji: string, background: string) => void
  className?: string
}

function EmojiPicker({
  open,
  onOpenChange,
  onSelect,
  className,
}: EmojiPickerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open
        ? (
            <EmojiPickerContent
              className={className}
              onOpenChange={onOpenChange}
              onSelect={onSelect}
            />
          )
        : null}
    </Dialog>
  )
}

type EmojiPickerContentProps = {
  className?: string
  onOpenChange: (open: boolean) => void
  onSelect?: (emoji: string, background: string) => void
}

function EmojiPickerContent({
  className,
  onOpenChange,
  onSelect,
}: EmojiPickerContentProps) {
  const { t } = useTranslation()
  const [selectedEmoji, setSelectedEmoji] = useState('')
  const [selectedBackground, setSelectedBackground] = useState<string>()

  return (
    <DialogContent
      className={cn(
        'max-h-none w-full overflow-hidden! text-left align-middle',
        'flex max-h-[552px] flex-col rounded-xl border-[0.5px] border-divider-subtle p-0 shadow-xl',
        className,
      )}
    >
      <DialogTitle className="sr-only">
        {t('iconPicker.emoji', { ns: 'app' })}
      </DialogTitle>

      <EmojiPickerInner
        className="pt-3"
        onSelect={(emoji, background) => {
          setSelectedEmoji(emoji)
          setSelectedBackground(background)
        }}
      />
      <Divider className="mt-3 mb-0" />
      <div className="flex w-full items-center justify-center gap-2 p-3">
        <Button
          className="w-full"
          onClick={() => onOpenChange(false)}
        >
          {t('iconPicker.cancel', { ns: 'app' })}
        </Button>
        <Button
          disabled={selectedEmoji === '' || !selectedBackground}
          variant="primary"
          className="w-full"
          onClick={() => {
            onSelect?.(selectedEmoji, selectedBackground!)
            onOpenChange(false)
          }}
        >
          {t('iconPicker.ok', { ns: 'app' })}
        </Button>
      </div>
    </DialogContent>
  )
}
export default EmojiPicker
