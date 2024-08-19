'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import s from './style.module.css'
import EmojiPickerInner from './Inner'
import cn from '@/utils/classnames'
import Divider from '@/app/components/base/divider'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'

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
    ? <Modal
      onClose={() => { }}
      isShow
      closable={false}
      wrapperClassName={className}
      className={cn(s.container, '!w-[362px] !p-0')}
    >
      <EmojiPickerInner
        className="pt-3"
        onSelect={handleSelectEmoji} />
      <Divider className='m-0' />
      <div className='w-full flex items-center justify-center p-3 gap-2'>
        <Button className='w-full' onClick={() => {
          onClose && onClose()
        }}>
          {t('app.iconPicker.cancel')}
        </Button>
        <Button
          disabled={selectedEmoji === '' || !selectedBackground}
          variant="primary"
          className='w-full'
          onClick={() => {
            onSelect && onSelect(selectedEmoji, selectedBackground!)
          }}>
          {t('app.iconPicker.ok')}
        </Button>
      </div>
    </Modal>
    : <></>
}
export default EmojiPicker
