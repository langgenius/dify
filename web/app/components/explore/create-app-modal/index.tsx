'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import AppIcon from '@/app/components/base/app-icon'
import EmojiPicker from '@/app/components/base/emoji-picker'
import { useProviderContext } from '@/context/provider-context'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'

export type CreateAppModalProps = {
  show: boolean
  isEditModal?: boolean
  appName: string
  appDescription: string
  appIcon: string
  appIconBackground: string
  onConfirm: (info: {
    name: string
    icon: string
    icon_background: string
    description: string
  }) => Promise<void>
  onHide: () => void
}

const CreateAppModal = ({
  show = false,
  isEditModal = false,
  appIcon,
  appIconBackground,
  appName,
  appDescription,
  onConfirm,
  onHide,
}: CreateAppModalProps) => {
  const { t } = useTranslation()

  const [name, setName] = React.useState(appName)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [emoji, setEmoji] = useState({ icon: appIcon, icon_background: appIconBackground })
  const [description, setDescription] = useState(appDescription || '')

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
      description,
    })
    onHide()
  }

  return (
    <>
      <Modal
        isShow={show}
        onClose={() => {}}
        className='relative !max-w-[480px] px-8'
      >
        <div className='absolute right-4 top-4 p-2 cursor-pointer' onClick={onHide}>
          <RiCloseLine className='w-4 h-4 text-gray-500' />
        </div>
        {isEditModal && (
          <div className='mb-9 font-semibold text-xl leading-[30px] text-gray-900'>{t('app.editAppTitle')}</div>
        )}
        {!isEditModal && (
          <div className='mb-9 font-semibold text-xl leading-[30px] text-gray-900'>{t('explore.appCustomize.title', { name: appName })}</div>
        )}
        <div className='mb-9'>
          {/* icon & name */}
          <div className='pt-2'>
            <div className='py-2 text-sm font-medium leading-[20px] text-gray-900'>{t('app.newApp.captionName')}</div>
            <div className='flex items-center justify-between space-x-2'>
              <AppIcon size='large' onClick={() => { setShowEmojiPicker(true) }} className='cursor-pointer' icon={emoji.icon} background={emoji.icon_background} />
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t('app.newApp.appNamePlaceholder') || ''}
                className='grow h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg border border-transparent outline-none appearance-none caret-primary-600 placeholder:text-gray-400 hover:bg-gray-50 hover:border hover:border-gray-300 focus:bg-gray-50 focus:border focus:border-gray-300 focus:shadow-xs'
              />
            </div>
          </div>
          {/* description */}
          <div className='pt-2'>
            <div className='py-2 text-sm font-medium leading-[20px] text-gray-900'>{t('app.newApp.captionDescription')}</div>
            <textarea
              className='w-full h-10 px-3 py-2 text-sm font-normal bg-gray-100 rounded-lg border border-transparent outline-none appearance-none caret-primary-600 placeholder:text-gray-400 hover:bg-gray-50 hover:border hover:border-gray-300 focus:bg-gray-50 focus:border focus:border-gray-300 focus:shadow-xs h-[80px] resize-none'
              placeholder={t('app.newApp.appDescriptionPlaceholder') || ''}
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
          {!isEditModal && isAppsFull && <AppsFull loc='app-explore-create' />}
        </div>
        <div className='flex flex-row-reverse'>
          <Button disabled={!isEditModal && isAppsFull} className='w-24 ml-2' variant='primary' onClick={submit}>{!isEditModal ? t('common.operation.create') : t('common.operation.save')}</Button>
          <Button className='w-24' onClick={onHide}>{t('common.operation.cancel')}</Button>
        </div>
      </Modal>
      {showEmojiPicker && <EmojiPicker
        onSelect={(icon, icon_background) => {
          setEmoji({ icon, icon_background })
          setShowEmojiPicker(false)
        }}
        onClose={() => {
          setEmoji({ icon: appIcon, icon_background: appIconBackground })
          setShowEmojiPicker(false)
        }}
      />}
    </>

  )
}

export default CreateAppModal
