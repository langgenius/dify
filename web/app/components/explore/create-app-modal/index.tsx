'use client'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine, RiCommandLine, RiCornerDownLeftLine } from '@remixicon/react'
import { useDebounceFn, useKeyPress } from 'ahooks'
import AppIconPicker from '../../base/app-icon-picker'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import Switch from '@/app/components/base/switch'
import Toast from '@/app/components/base/toast'
import AppIcon from '@/app/components/base/app-icon'
import { useProviderContext } from '@/context/provider-context'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import type { AppIconType } from '@/types/app'
import { noop } from 'lodash-es'

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
  max_active_requests?: number | null
  onConfirm: (info: {
    name: string
    icon_type: AppIconType
    icon: string
    icon_background?: string
    description: string
    use_icon_as_answer_icon?: boolean
    max_active_requests?: number | null
  }) => Promise<void>
  confirmDisabled?: boolean
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
  max_active_requests,
  onConfirm,
  confirmDisabled,
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

  const [maxActiveRequestsInput, setMaxActiveRequestsInput] = useState(
    max_active_requests !== null && max_active_requests !== undefined ? String(max_active_requests) : '',
  )

  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = (enableBilling && plan.usage.buildApps >= plan.total.buildApps)

  const submit = useCallback(() => {
    if (!name.trim()) {
      Toast.notify({ type: 'error', message: t('explore.appCustomize.nameRequired') })
      return
    }
    const isValid = maxActiveRequestsInput.trim() !== '' && !isNaN(Number(maxActiveRequestsInput))
    const payload: any = {
      name,
      icon_type: appIcon.type,
      icon: appIcon.type === 'emoji' ? appIcon.icon : appIcon.fileId,
      icon_background: appIcon.type === 'emoji' ? appIcon.background! : undefined,
      description,
      use_icon_as_answer_icon: useIconAsAnswerIcon,
    }
    if (isValid)
      payload.max_active_requests = Number(maxActiveRequestsInput)

    onConfirm(payload)
    onHide()
  }, [name, appIcon, description, useIconAsAnswerIcon, onConfirm, onHide, t, maxActiveRequestsInput])

  const { run: handleSubmit } = useDebounceFn(submit, { wait: 300 })

  useKeyPress(['meta.enter', 'ctrl.enter'], () => {
    if (show && !(!isEditModal && isAppsFull) && name.trim())
      handleSubmit()
  })

  useKeyPress('esc', () => {
    if (show)
      onHide()
  })

  return (
    <>
      <Modal
        isShow={show}
        onClose={noop}
        className='relative !max-w-[480px] px-8'
      >
        <div className='absolute right-4 top-4 cursor-pointer p-2' onClick={onHide}>
          <RiCloseLine className='h-4 w-4 text-text-tertiary' />
        </div>
        {isEditModal && (
          <div className='mb-9 text-xl font-semibold leading-[30px] text-text-primary'>{t('app.editAppTitle')}</div>
        )}
        {!isEditModal && (
          <div className='mb-9 text-xl font-semibold leading-[30px] text-text-primary'>{t('explore.appCustomize.title', { name: appName })}</div>
        )}
        <div className='mb-9'>
          {/* icon & name */}
          <div className='pt-2'>
            <div className='py-2 text-sm font-medium leading-[20px] text-text-primary'>{t('app.newApp.captionName')}</div>
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
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t('app.newApp.appNamePlaceholder') || ''}
                className='h-10 grow'
              />
            </div>
          </div>
          {/* description */}
          <div className='pt-2'>
            <div className='py-2 text-sm font-medium leading-[20px] text-text-primary'>{t('app.newApp.captionDescription')}</div>
            <Textarea
              className='resize-none'
              placeholder={t('app.newApp.appDescriptionPlaceholder') || ''}
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
          {/* answer icon */}
          {isEditModal && (appMode === 'chat' || appMode === 'advanced-chat' || appMode === 'agent-chat') && (
            <div className='pt-2'>
              <div className='flex items-center justify-between'>
                <div className='py-2 text-sm font-medium leading-[20px] text-text-primary'>{t('app.answerIcon.title')}</div>
                <Switch
                  defaultValue={useIconAsAnswerIcon}
                  onChange={v => setUseIconAsAnswerIcon(v)}
                />
              </div>
              <p className='body-xs-regular text-text-tertiary'>{t('app.answerIcon.descriptionInExplore')}</p>
            </div>
          )}
          {isEditModal && (
            <div className='pt-2'>
              <div className='mb-2 mt-2 text-sm font-medium leading-[20px] text-text-primary'>{t('app.maxActiveRequests')}</div>
              <Input
                type='number'
                min={1}
                placeholder={t('app.maxActiveRequestsPlaceholder')}
                value={maxActiveRequestsInput}
                onChange={(e) => {
                  setMaxActiveRequestsInput(e.target.value)
                }}
                className='h-10 w-full'
              />
              <p className='body-xs-regular mb-0 mt-2 text-text-tertiary'>{t('app.maxActiveRequestsTip')}</p>
            </div>
          )}
          {!isEditModal && isAppsFull && <AppsFull className='mt-4' loc='app-explore-create' />}
        </div>
        <div className='flex flex-row-reverse'>
          <Button
            disabled={(!isEditModal && isAppsFull) || !name.trim() || confirmDisabled}
            className='ml-2 w-24 gap-1'
            variant='primary'
            onClick={handleSubmit}
          >
            <span>{!isEditModal ? t('common.operation.create') : t('common.operation.save')}</span>
            <div className='flex gap-0.5'>
              <RiCommandLine size={14} className='system-kbd rounded-sm bg-components-kbd-bg-white p-0.5' />
              <RiCornerDownLeftLine size={14} className='system-kbd rounded-sm bg-components-kbd-bg-white p-0.5' />
            </div>
          </Button>
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
