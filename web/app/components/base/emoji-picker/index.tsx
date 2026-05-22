'use client'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import EmojiPickerInner from './Inner'

type IEmojiPickerProps = {
  isModal?: boolean
  onSelect?: (emoji: string, background: string) => void
  onClose?: () => void
  className?: string
}

const EmojiPicker: FC<IEmojiPickerProps> = ({
  isModal = true,
  onSelect,
  onClose,
  className,
}) => {
  const { t } = useTranslation()
  const [selectedEmoji, setSelectedEmoji] = useState('')
  const [selectedBackground, setSelectedBackground] = useState<string>()

  const handleSelectEmoji = useCallback((emoji: string, background: string) => {
    setSelectedEmoji(emoji)
    setSelectedBackground(background)
  }, [setSelectedEmoji, setSelectedBackground])

  return isModal
    ? (
        <Dialog open>
          <DialogContent
            className={cn(
              'max-h-none w-full overflow-hidden! text-left align-middle',
              'flex max-h-[552px] flex-col rounded-xl border-[0.5px] border-divider-subtle p-0 shadow-xl',
              className,
            )}
          >

            <EmojiPickerInner
              className="pt-3"
              onSelect={handleSelectEmoji}
            />
            <Divider className="mt-3 mb-0" />
            <div className="flex w-full items-center justify-center gap-2 p-3">
              <Button
                className="w-full"
                onClick={() => {
                  onClose?.()
                }}
              >
                {t('iconPicker.cancel', { ns: 'app' })}
              </Button>
              <Button
                disabled={selectedEmoji === '' || !selectedBackground}
                variant="primary"
                className="w-full"
                onClick={() => {
                  onSelect?.(selectedEmoji, selectedBackground!)
                }}
              >
                {t('iconPicker.ok', { ns: 'app' })}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )
    : <></>
}
export default EmojiPicker
