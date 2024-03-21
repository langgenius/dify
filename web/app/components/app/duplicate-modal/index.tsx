'use client'
import React, { useState } from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import s from './style.module.css'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import AppIcon from '@/app/components/base/app-icon'
import EmojiPicker from '@/app/components/base/emoji-picker'
import { useProviderContext } from '@/context/provider-context'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
export type DuplicateAppModalProps = {
  appName: string
  icon: string
  icon_background: string
  show: boolean
  onConfirm: (info: {
    name: string
    icon: string
    icon_background: string
  }) => Promise<void>
  onHide: () => void
}

const DuplicateAppModal = ({
  appName,
  icon,
  icon_background,
  show = false,
  onConfirm,
  onHide,
}: DuplicateAppModalProps) => {
  const { t } = useTranslation()

  const [name, setName] = React.useState(appName)

  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [emoji, setEmoji] = useState({ icon, icon_background })

  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = (enableBilling && plan.usage.buildApps >= plan.total.buildApps)

  const submit = () => {
    if (!name.trim()) {
      Toast.notify({ type: 'error', message: t('explore.appCustomize.nameRequired') })
      return
    }
    onConfirm({
      name,
      ...emoji,
    })
    onHide()
  }

  return (
    <>
      <Modal
        isShow={show}
        onClose={() => { }}
        className={cn(s.modal, '!max-w-[480px]', 'px-8')}
      >
        <span className={s.close} onClick={onHide} />
        <div className={s.title}>{t('app.duplicateTitle')}</div>
        <div className={s.content}>
          <div className={s.subTitle}>{t('explore.appCustomize.subTitle')}</div>
          <div className='flex items-center justify-between space-x-2'>
            <AppIcon size='large' onClick={() => { setShowEmojiPicker(true) }} className='cursor-pointer' icon={emoji.icon} background={emoji.icon_background} />
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className='h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg grow'
            />
          </div>
          {isAppsFull && <AppsFull loc='app-duplicate-create' />}
        </div>
        <div className='flex flex-row-reverse'>
          <Button disabled={isAppsFull} className='w-24 ml-2' type='primary' onClick={submit}>{t('app.duplicate')}</Button>
          <Button className='w-24' onClick={onHide}>{t('common.operation.cancel')}</Button>
        </div>
      </Modal>
      {showEmojiPicker && <EmojiPicker
        onSelect={(icon, icon_background) => {
          setEmoji({ icon, icon_background })
          setShowEmojiPicker(false)
        }}
        onClose={() => {
          setEmoji({ icon, icon_background })
          setShowEmojiPicker(false)
        }}
      />}
    </>

  )
}

export default DuplicateAppModal
