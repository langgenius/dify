'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import AppIconPicker from '../../base/app-icon-picker'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Switch from '@/app/components/base/switch'
import Toast from '@/app/components/base/toast'
import AppIcon from '@/app/components/base/app-icon'
import { useProviderContext } from '@/context/provider-context'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import type { AppIconType } from '@/types/app'

export type CreateAppModalProps = {
  show: boolean
  isEditModal?: boolean
  appName: string
  appDescription: string
  appIconType: AppIconType | null
  appIcon: string
  appIconBackground?: string | null
  appIconUrl?: string | null
  appMode?: string
  appUseIconAsAnswerIcon?: boolean
  onConfirm: (info: {
    name: string
    icon_type: AppIconType
    icon: string
    icon_background?: string
    description: string
    use_icon_as_answer_icon?: boolean
  }) => Promise<void>
  onHide: () => void
}

const CreateAppModal = ({
  show = false,
  isEditModal = false,
  appIconType,
  appIcon: _appIcon,
  appIconBackground,
  appIconUrl,
  appName,
  appDescription,
  appMode,
  appUseIconAsAnswerIcon,
  onConfirm,
  onHide,
}: CreateAppModalProps) => {
  const { t } = useTranslation()

  const [name, setName] = React.useState(appName)
  const [appIcon, setAppIcon] = useState(
    () => appIconType === 'image'
      ? { type: 'image' as const, fileId: _appIcon, url: appIconUrl }
      : { type: 'emoji' as const, icon: _appIcon, background: appIconBackground },
  )
  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const [description, setDescription] = useState(appDescription || '')
  const [useIconAsAnswerIcon, setUseIconAsAnswerIcon] = useState(appUseIconAsAnswerIcon || false)

  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = (enableBilling && plan.usage.buildApps >= plan.total.buildApps)

  const submit = () => {
    if (!name.trim()) {
      Toast.notify({ type: 'error', message: t('explore.appCustomize.nameRequired') })
      return
    }
    onConfirm({
      name,
      icon_type: appIcon.type,
      icon: appIcon.type === 'emoji' ? appIcon.icon : appIcon.fileId,
      icon_background: appIcon.type === 'emoji' ? appIcon.background! : undefined,
      description,
      use_icon_as_answer_icon: useIconAsAnswerIcon,
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
              <AppIcon
                size='large'
                onClick={() => { setShowAppIconPicker(true) }}
                className='cursor-pointer'
                iconType={appIcon.type}
                icon={appIcon.type === 'image' ? appIcon.fileId : appIcon.icon}
                background={appIcon.type === 'image' ? undefined : appIcon.background}
                imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
              />
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
          {/* answer icon */}
          {isEditModal && (appMode === 'chat' || appMode === 'advanced-chat' || appMode === 'agent-chat') && (
            <div className='pt-2'>
              <div className='flex justify-between items-center'>
                <div className='py-2 text-sm font-medium leading-[20px] text-gray-900'>{t('app.answerIcon.title')}</div>
                <Switch
                  defaultValue={useIconAsAnswerIcon}
                  onChange={v => setUseIconAsAnswerIcon(v)}
                />
              </div>
              <p className='body-xs-regular text-gray-500'>{t('app.answerIcon.descriptionInExplore')}</p>
            </div>
          )}
          {!isEditModal && isAppsFull && <AppsFull loc='app-explore-create' />}
        </div>
        <div className='flex flex-row-reverse'>
          <Button disabled={!isEditModal && isAppsFull} className='w-24 ml-2' variant='primary' onClick={submit}>{!isEditModal ? t('common.operation.create') : t('common.operation.save')}</Button>
          <Button className='w-24' onClick={onHide}>{t('common.operation.cancel')}</Button>
        </div>
      </Modal>
      {showAppIconPicker && <AppIconPicker
        onSelect={(payload) => {
          setAppIcon(payload)
          setShowAppIconPicker(false)
        }}
        onClose={() => {
          setAppIcon(appIconType === 'image'
            ? { type: 'image' as const, url: appIconUrl, fileId: _appIcon }
            : { type: 'emoji' as const, icon: _appIcon, background: appIconBackground })
          setShowAppIconPicker(false)
        }}
      />}
    </>
  )
}

export default CreateAppModal
