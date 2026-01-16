'use client'
import type { AppIconType } from '@/types/app'
import { RiCloseLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'
import Toast from '@/app/components/base/toast'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { useProviderContext } from '@/context/provider-context'
import { cn } from '@/utils/classnames'
import AppIconPicker from '../../base/app-icon-picker'

export type DuplicateAppModalProps = {
  appName: string
  icon_type: AppIconType | null
  icon: string
  icon_background?: string | null
  icon_url?: string | null
  show: boolean
  onConfirm: (info: {
    name: string
    icon_type: AppIconType
    icon: string
    icon_background?: string | null
  }) => Promise<void>
  onHide: () => void
}

const DuplicateAppModal = ({
  appName,
  icon_type,
  icon,
  icon_background,
  icon_url,
  show = false,
  onConfirm,
  onHide,
}: DuplicateAppModalProps) => {
  const { t } = useTranslation()

  const [name, setName] = React.useState(appName)

  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const [appIcon, setAppIcon] = useState(
    icon_type === 'image'
      ? { type: 'image' as const, url: icon_url, fileId: icon }
      : { type: 'emoji' as const, icon, background: icon_background },
  )

  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = (enableBilling && plan.usage.buildApps >= plan.total.buildApps)

  const submit = () => {
    if (!name.trim()) {
      Toast.notify({ type: 'error', message: t('appCustomize.nameRequired', { ns: 'explore' }) })
      return
    }
    onConfirm({
      name,
      icon_type: appIcon.type,
      icon: appIcon.type === 'emoji' ? appIcon.icon : appIcon.fileId,
      icon_background: appIcon.type === 'emoji' ? appIcon.background : undefined,
    })
    onHide()
  }

  return (
    <>
      <Modal
        isShow={show}
        onClose={noop}
        className={cn('relative !max-w-[480px]', 'px-8')}
      >
        <div className="absolute right-4 top-4 cursor-pointer p-2" onClick={onHide}>
          <RiCloseLine className="h-4 w-4 text-text-tertiary" />
        </div>
        <div className="relative mb-9 mt-3 text-xl font-semibold leading-[30px] text-text-primary">{t('duplicateTitle', { ns: 'app' })}</div>
        <div className="system-sm-regular mb-9 text-text-secondary">
          <div className="system-md-medium mb-2">{t('appCustomize.subTitle', { ns: 'explore' })}</div>
          <div className="flex items-center justify-between space-x-2">
            <AppIcon
              size="large"
              onClick={() => { setShowAppIconPicker(true) }}
              className="cursor-pointer"
              iconType={appIcon.type}
              icon={appIcon.type === 'image' ? appIcon.fileId : appIcon.icon}
              background={appIcon.type === 'image' ? undefined : appIcon.background}
              imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
            />
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              className="h-10"
            />
          </div>
          {isAppsFull && <AppsFull className="mt-4" loc="app-duplicate-create" />}
        </div>
        <div className="flex flex-row-reverse">
          <Button disabled={isAppsFull} className="ml-2 w-24" variant="primary" onClick={submit}>{t('duplicate', { ns: 'app' })}</Button>
          <Button className="w-24" onClick={onHide}>{t('operation.cancel', { ns: 'common' })}</Button>
        </div>
      </Modal>
      {showAppIconPicker && (
        <AppIconPicker
          onSelect={(payload) => {
            setAppIcon(payload)
            setShowAppIconPicker(false)
          }}
          onClose={() => {
            setAppIcon(icon_type === 'image'
              ? { type: 'image', url: icon_url!, fileId: icon }
              : { type: 'emoji', icon, background: icon_background! })
            setShowAppIconPicker(false)
          }}
        />
      )}
    </>

  )
}

export default DuplicateAppModal
