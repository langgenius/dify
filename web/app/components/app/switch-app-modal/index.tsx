'use client'

import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import { zIconType } from '@dify/contracts/api/console/apps/zod.gen'
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
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import AppIcon from '@/app/components/base/app-icon'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { useProviderContext } from '@/context/provider-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'
import { getRedirection } from '@/utils/app-redirection'
import AppIconPicker from '../../base/app-icon-picker'

type SwitchAppModalProps = {
  show: boolean
  appDetail: Pick<
    AppPartial,
    'icon' | 'icon_background' | 'icon_type' | 'icon_url' | 'id' | 'mode' | 'name'
  >
  onClose: () => void
  inAppDetail?: boolean
}

const SwitchAppModal = ({ show, appDetail, inAppDetail = false, onClose }: SwitchAppModalProps) => {
  const { push, replace } = useRouter()
  const nameInputId = useId()
  const { t } = useTranslation()
  const setAppDetail = useAppStore((s) => s.setAppDetail)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const isRbacEnabled = systemFeatures.rbac_enabled

  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = enableBilling && plan.usage.buildApps >= plan.total.buildApps

  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const appIconType = zIconType.safeParse(appDetail.icon_type).data
  const [appIcon, setAppIcon] = useState(
    appIconType === 'image'
      ? { type: 'image' as const, url: appDetail.icon_url, fileId: appDetail.icon ?? '' }
      : {
          type: 'emoji' as const,
          icon: appDetail.icon ?? '',
          background: appDetail.icon_background,
        },
  )

  const [name, setName] = useState(`${appDetail.name}(copy)`)
  const [removeOriginal, setRemoveOriginal] = useState<boolean>(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const { mutateAsync: convertToWorkflow } = useMutation(
    consoleQuery.apps.byAppId.convertToWorkflow.post.mutationOptions(),
  )
  const { mutateAsync: deleteOriginalApp } = useMutation(
    consoleQuery.apps.byAppId.delete.mutationOptions(),
  )

  const goStart = async () => {
    try {
      const { new_app_id: newAppID, permission_keys } = await convertToWorkflow({
        params: { app_id: appDetail.id },
        body: {
          name,
          icon_type: appIcon.type,
          icon: appIcon.type === 'emoji' ? appIcon.icon : appIcon.fileId,
          icon_background: appIcon.type === 'emoji' ? appIcon.background : undefined,
        },
      })
      onClose()
      toast.success(t(($) => $['newApp.appCreated'], { ns: 'app' }))
      if (inAppDetail) setAppDetail()
      if (removeOriginal)
        await deleteOriginalApp({
          params: { app_id: appDetail.id },
        })
      getRedirection(
        {
          id: newAppID,
          mode:
            appDetail.mode === AppModeEnum.COMPLETION
              ? AppModeEnum.WORKFLOW
              : AppModeEnum.ADVANCED_CHAT,
          permission_keys,
        },
        removeOriginal ? replace : push,
        { isRbacEnabled },
      )
    } catch {
      toast.error(t(($) => $['newApp.appCreateFailed'], { ns: 'app' }))
    }
  }

  const handleConfirmDeleteOpenChange = (open: boolean) => {
    if (open) return

    setShowConfirmDelete(false)
    setRemoveOriginal(false)
  }

  return (
    <>
      <Dialog open={show}>
        <DialogContent
          className={cn(
            'w-full overflow-hidden! border-none text-left align-middle',
            cn('w-150 max-w-150 p-8'),
          )}
        >
          <button
            type="button"
            className="absolute top-4 right-4 cursor-pointer border-none bg-transparent p-2 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            onClick={onClose}
          >
            <span aria-hidden className="i-ri-close-line size-4 text-text-tertiary" />
          </button>
          <div className="h-12 w-12 rounded-xl border-[0.5px] border-divider-regular bg-background-default-burn p-3 shadow-xl">
            <span
              aria-hidden
              className="i-custom-vender-solid-alertsAndFeedback-alert-triangle size-6 text-[rgb(247,144,9)]"
            />
          </div>
          <div className="relative mt-3 text-xl leading-7.5 font-semibold text-text-primary">
            {t(($) => $.switch, { ns: 'app' })}
          </div>
          <div className="my-1 text-sm/5 text-text-tertiary">
            <span>{t(($) => $.switchTipStart, { ns: 'app' })}</span>
            <span className="font-medium text-text-secondary">
              {t(($) => $.switchTip, { ns: 'app' })}
            </span>
            <span>{t(($) => $.switchTipEnd, { ns: 'app' })}</span>
          </div>
          <div className="pb-4">
            <label
              htmlFor={nameInputId}
              className="block py-2 text-sm leading-5 font-medium text-text-primary"
            >
              {t(($) => $.switchLabel, { ns: 'app' })}
            </label>
            <div className="flex items-center justify-between space-x-2">
              <AppIcon
                size="large"
                onClick={() => {
                  setShowAppIconPicker(true)
                }}
                className="cursor-pointer"
                iconType={appIcon.type}
                icon={appIcon.type === 'image' ? appIcon.fileId : appIcon.icon}
                background={appIcon.type === 'image' ? undefined : appIcon.background}
                imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
              />
              <Input
                id={nameInputId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t(($) => $['newApp.appNamePlaceholder'], { ns: 'app' }) || ''}
                className="h-10 grow"
              />
            </div>
            {showAppIconPicker && (
              <AppIconPicker
                open={showAppIconPicker}
                initialEmoji={
                  appIcon.type === 'emoji'
                    ? { icon: appIcon.icon, background: appIcon.background }
                    : undefined
                }
                onOpenChange={setShowAppIconPicker}
                onSelect={(payload) => {
                  setAppIcon(payload)
                }}
              />
            )}
          </div>
          {isAppsFull && <AppsFull loc="app-switch" />}
          <div className="flex items-center justify-between pt-6">
            <div className="flex items-center">
              <label className="flex cursor-pointer items-center">
                <Checkbox
                  className="shrink-0"
                  checked={removeOriginal}
                  onCheckedChange={(checked) => {
                    setRemoveOriginal(checked)
                    if (checked) setShowConfirmDelete(true)
                  }}
                />
                <span className="ml-2 text-left text-sm/5 text-text-secondary">
                  {t(($) => $.removeOriginal, { ns: 'app' })}
                </span>
              </label>
            </div>
            <div className="flex items-center">
              <Button className="mr-2" onClick={onClose}>
                {t(($) => $['newApp.Cancel'], { ns: 'app' })}
              </Button>
              <Button
                className="inset-ring-red-700"
                disabled={isAppsFull || !name}
                variant="primary"
                tone="destructive"
                onClick={goStart}
              >
                {t(($) => $.switchStart, { ns: 'app' })}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={showConfirmDelete} onOpenChange={handleConfirmDeleteOpenChange}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t(($) => $.deleteAppConfirmTitle, { ns: 'app' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t(($) => $.deleteAppConfirmContent, { ns: 'app' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={() => setShowConfirmDelete(false)}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default SwitchAppModal
