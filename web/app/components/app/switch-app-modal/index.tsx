'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import s from './style.module.css'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import Confirm from '@/app/components/base/confirm'
import { ToastContext } from '@/app/components/base/toast'
import { deleteApp, switchApp } from '@/service/apps'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import EmojiPicker from '@/app/components/base/emoji-picker'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { getRedirection } from '@/utils/app-redirection'
import type { App } from '@/types/app'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import AppIcon from '@/app/components/base/app-icon'
import { useStore as useAppStore } from '@/app/components/app/store'

type SwitchAppModalProps = {
  show: boolean
  appDetail: App
  onSuccess?: () => void
  onClose: () => void
  inAppDetail?: boolean
}

const SwitchAppModal = ({ show, appDetail, inAppDetail = false, onSuccess, onClose }: SwitchAppModalProps) => {
  const { push, replace } = useRouter()
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const setAppDetail = useAppStore(s => s.setAppDetail)

  const { isCurrentWorkspaceManager } = useAppContext()
  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = (enableBilling && plan.usage.buildApps >= plan.total.buildApps)

  const [emoji, setEmoji] = useState({ icon: appDetail.icon, icon_background: appDetail.icon_background })
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [name, setName] = useState(`${appDetail.name}(copy)`)
  const [removeOriginal, setRemoveOriginal] = useState<boolean>(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)

  const goStart = async () => {
    try {
      const { new_app_id: newAppID } = await switchApp({
        appID: appDetail.id,
        name,
        icon: emoji.icon,
        icon_background: emoji.icon_background,
      })
      if (onSuccess)
        onSuccess()
      if (onClose)
        onClose()
      notify({ type: 'success', message: t('app.newApp.appCreated') })
      if (inAppDetail)
        setAppDetail()
      if (removeOriginal)
        await deleteApp(appDetail.id)
      localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
      getRedirection(
        isCurrentWorkspaceManager,
        {
          id: newAppID,
          mode: appDetail.mode === 'completion' ? 'workflow' : 'advanced-chat',
        },
        removeOriginal ? replace : push,
      )
    }
    catch (e) {
      notify({ type: 'error', message: t('app.newApp.appCreateFailed') })
    }
  }

  useEffect(() => {
    if (removeOriginal)
      setShowConfirmDelete(true)
  }, [removeOriginal])

  return (
    <>
      <Modal
        wrapperClassName='z-20'
        className={cn('p-8 max-w-[600px] w-[600px]', s.bg)}
        isShow={show}
        onClose={() => {}}
      >
        <div className='absolute right-4 top-4 p-2 cursor-pointer' onClick={onClose}>
          <XClose className='w-4 h-4 text-gray-500' />
        </div>
        <div className='w-12 h-12 p-3 bg-white rounded-xl border-[0.5px] border-gray-100 shadow-xl'>
          <AlertTriangle className='w-6 h-6 text-[rgb(247,144,9)]' />
        </div>
        <div className='relative mt-3 text-xl font-semibold leading-[30px] text-gray-900'>{t('app.switch')}</div>
        <div className='my-1 text-gray-500 text-sm leading-5'>
          <span>{t('app.switchTipStart')}</span>
          <span className='text-gray-700 font-medium'>{t('app.switchTip')}</span>
          <span>{t('app.switchTipEnd')}</span>
        </div>
        <div className='pb-4'>
          <div className='py-2 text-sm font-medium leading-[20px] text-gray-900'>{t('app.switchLabel')}</div>
          <div className='flex items-center justify-between space-x-2'>
            <AppIcon size='large' onClick={() => { setShowEmojiPicker(true) }} className='cursor-pointer' icon={emoji.icon} background={emoji.icon_background} />
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('app.newApp.appNamePlaceholder') || ''}
              className='grow h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg border border-transparent outline-none appearance-none caret-primary-600 placeholder:text-gray-400 hover:bg-gray-50 hover:border hover:border-gray-300 focus:bg-gray-50 focus:border focus:border-gray-300 focus:shadow-xs'
            />
          </div>
          {showEmojiPicker && <EmojiPicker
            onSelect={(icon, icon_background) => {
              setEmoji({ icon, icon_background })
              setShowEmojiPicker(false)
            }}
            onClose={() => {
              setEmoji({ icon: appDetail.icon, icon_background: appDetail.icon_background })
              setShowEmojiPicker(false)
            }}
          />}
        </div>
        {isAppsFull && <AppsFull loc='app-switch' />}
        <div className='pt-6 flex justify-between items-center'>
          <div className='flex items-center'>
            <input id="removeOriginal" type="checkbox" checked={removeOriginal} onChange={() => setRemoveOriginal(!removeOriginal)} className="w-4 h-4 rounded border-gray-300 text-blue-700 cursor-pointer focus:ring-blue-700" />
            <label htmlFor="removeOriginal" className="ml-2 text-sm leading-5 text-gray-700 cursor-pointer">{t('app.removeOriginal')}</label>
          </div>
          <div className='flex items-center'>
            <Button className='mr-2 text-gray-700 text-sm font-medium' onClick={onClose}>{t('app.newApp.Cancel')}</Button>
            <Button className='text-sm font-medium border-red-700 border-[0.5px]' disabled={isAppsFull || !name} type="warning" onClick={goStart}>{t('app.switchStart')}</Button>
          </div>
        </div>
      </Modal>
      {showConfirmDelete && (
        <Confirm
          title={t('app.deleteAppConfirmTitle')}
          content={t('app.deleteAppConfirmContent')}
          isShow={showConfirmDelete}
          onConfirm={() => setShowConfirmDelete(false)}
          onCancel={() => {
            setShowConfirmDelete(false)
            setRemoveOriginal(false)
          }}
          onClose={() => {
            setShowConfirmDelete(false)
            setRemoveOriginal(false)
          }}
        />
      )}
    </>
  )
}

export default SwitchAppModal
