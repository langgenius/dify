'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import style from '../list.module.css'
import Dialog from '@/app/components/base/dialog'
import Button from '@/app/components/base/button'
import AppIcon from '@/app/components/base/app-icon'
import EmojiPicker from '@/app/components/base/emoji-picker'
import type { App } from '@/types/app'

type Props = {
  isShow: boolean
  onClose: () => void
  appIcon: { icon: App['icon']; icon_background: App['icon_background'] }
  appName: App['name']
  onUpdate: (v: any) => void
  loading: boolean
}

const AppSettings = (props: Props) => {
  const { isShow, onClose, appIcon, appName, onUpdate, loading } = props
  const { t } = useTranslation()
  // Emoji Picker
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [emoji, setEmoji] = useState(appIcon)
  // input name
  const [inputName, setInputName] = useState(appName)

  return (
    <>
      {showEmojiPicker && (
        <EmojiPicker
          onSelect={(icon, icon_background) => {
            setEmoji({ icon, icon_background })
            setShowEmojiPicker(false)
          }}
          onClose={() => {
            setEmoji({ icon: '🤖', icon_background: '#FFEAD5' })
            setShowEmojiPicker(false)
          }}
        />
      )}
      <Dialog
        show={isShow}
        title={t('app.editApp.startToEdit')}
        footer={
          <>
            <Button onClick={onClose}>{t('common.operation.cancel')}</Button>
            <Button type="primary" loading={loading} onClick={() => onUpdate({ name: inputName, iconInfo: emoji })}>
              {t('common.operation.save')}
            </Button>
          </>
        }
      >
        <h3 className={style.newItemCaption}>{t('explore.appCustomize.subTitle')}</h3>

        <div className="flex items-center justify-between gap-3 mb-8">
          <AppIcon
            size="large"
            onClick={() => {
              setShowEmojiPicker(true)
            }}
            className="cursor-pointer"
            icon={emoji.icon}
            background={emoji.icon_background}
          />
          <input
            placeholder={t('app.appNamePlaceholder') || ''}
            onChange={e => setInputName(e.target.value)}
            value={inputName}
            className="h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg grow"
          />
        </div>
      </Dialog>
    </>
  )
}

export default AppSettings
