'use client'

import type { App } from '@/types/app'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { RiCloseLine } from '@remixicon/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import AppIcon from '@/app/components/base/app-icon'
import Checkbox from '@/app/components/base/checkbox'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import Input from '@/app/components/base/input'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { useRouter } from '@/next/navigation'
import { deleteApp, switchApp } from '@/service/apps'
import { AppModeEnum } from '@/types/app'
import { getRedirection } from '@/utils/app-redirection'
import AppIconPicker from '../../base/app-icon-picker'

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
  const setAppDetail = useAppStore(s => s.setAppDetail)

  const { isCurrentWorkspaceEditor } = useAppContext()
  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = (enableBilling && plan.usage.buildApps >= plan.total.buildApps)

  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const [appIcon, setAppIcon] = useState(
    appDetail.icon_type === 'image'
      ? { type: 'image' as const, url: appDetail.icon_url, fileId: appDetail.icon }
      : { type: 'emoji' as const, icon: appDetail.icon, background: appDetail.icon_background },
  )

  const [name, setName] = useState(`${appDetail.name}(copy)`)
  const [removeOriginal, setRemoveOriginal] = useState<boolean>(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)

  const goStart = async () => {
    try {
      const { new_app_id: newAppID } = await switchApp({
        appID: appDetail.id,
        name,
        icon_type: appIcon.type,
        icon: appIcon.type === 'emoji' ? appIcon.icon : appIcon.fileId,
        icon_background: appIcon.type === 'emoji' ? appIcon.background : undefined,
      })
      if (onSuccess)
        onSuccess()
      if (onClose)
        onClose()
      toast.success(t('newApp.appCreated', { ns: 'app' }))
      if (inAppDetail)
        setAppDetail()
      if (removeOriginal)
        await deleteApp(appDetail.id)
      localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
      getRedirection(
        isCurrentWorkspaceEditor,
        {
          id: newAppID,
          mode: appDetail.mode === AppModeEnum.COMPLETION ? AppModeEnum.WORKFLOW : AppModeEnum.ADVANCED_CHAT,
        },
        removeOriginal ? replace : push,
      )
    }
    catch {
      toast.error(t('newApp.appCreateFailed', { ns: 'app' }))
    }
  }

  useEffect(() => {
    if (removeOriginal)
      setShowConfirmDelete(true)
  }, [removeOriginal])

  const handleConfirmDeleteOpenChange = (open: boolean) => {
    if (open)
      return

    setShowConfirmDelete(false)
    setRemoveOriginal(false)
  }

  return (
    <>
      <Dialog open={show}>
        <DialogContent className={cn('w-full overflow-hidden! border-none text-left align-middle', cn('w-[600px] max-w-[600px] p-8'))}>

          <div className="absolute top-4 right-4 cursor-pointer p-2" onClick={onClose}>
            <RiCloseLine className="h-4 w-4 text-text-tertiary" />
          </div>
          <div className="h-12 w-12 rounded-xl border-[0.5px] border-divider-regular bg-background-default-burn p-3 shadow-xl">
            <AlertTriangle className="h-6 w-6 text-[rgb(247,144,9)]" />
          </div>
          <div className="relative mt-3 text-xl leading-[30px] font-semibold text-text-primary">{t('switch', { ns: 'app' })}</div>
          <div className="my-1 text-sm leading-5 text-text-tertiary">
            <span>{t('switchTipStart', { ns: 'app' })}</span>
            <span className="font-medium text-text-secondary">{t('switchTip', { ns: 'app' })}</span>
            <span>{t('switchTipEnd', { ns: 'app' })}</span>
          </div>
          <div className="pb-4">
            <div className="py-2 text-sm leading-[20px] font-medium text-text-primary">{t('switchLabel', { ns: 'app' })}</div>
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
                placeholder={t('newApp.appNamePlaceholder', { ns: 'app' }) || ''}
                className="h-10 grow"
              />
            </div>
            {showAppIconPicker && (
              <AppIconPicker
                onSelect={(payload) => {
                  setAppIcon(payload)
                  setShowAppIconPicker(false)
                }}
                onClose={() => {
                  setAppIcon(appDetail.icon_type === 'image'
                    ? { type: 'image' as const, url: appDetail.icon_url, fileId: appDetail.icon }
                    : { type: 'emoji' as const, icon: appDetail.icon, background: appDetail.icon_background })
                  setShowAppIconPicker(false)
                }}
              />
            )}
          </div>
          {isAppsFull && <AppsFull loc="app-switch" />}
          <div className="flex items-center justify-between pt-6">
            <div className="flex items-center">
              <Checkbox className="shrink-0" checked={removeOriginal} onCheck={() => setRemoveOriginal(!removeOriginal)} />
              <div className="ml-2 cursor-pointer text-sm leading-5 text-text-secondary" onClick={() => setRemoveOriginal(!removeOriginal)}>{t('removeOriginal', { ns: 'app' })}</div>
            </div>
            <div className="flex items-center">
              <Button className="mr-2" onClick={onClose}>{t('newApp.Cancel', { ns: 'app' })}</Button>
              <Button className="border-red-700" disabled={isAppsFull || !name} variant="primary" tone="destructive" onClick={goStart}>{t('switchStart', { ns: 'app' })}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={showConfirmDelete}
        onOpenChange={handleConfirmDeleteOpenChange}
      >
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t('deleteAppConfirmTitle', { ns: 'app' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t('deleteAppConfirmContent', { ns: 'app' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t('operation.cancel', { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={() => setShowConfirmDelete(false)}>
              {t('operation.confirm', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default SwitchAppModal
