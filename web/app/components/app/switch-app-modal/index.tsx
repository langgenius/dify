'use client'

import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import { zIconType } from '@dify/contracts/api/console/apps/zod.gen'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconPicker,
  IconPickerContent,
  IconPickerIcon,
  IconPickerTrigger,
} from '@/app/components/base/icon-picker'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { toast } from '@/app/notifications'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { getRedirection } from '@/utils/app-redirection'

type SwitchAppModalProps = {
  show: boolean
  sourceApp: Pick<
    AppPartial,
    'icon' | 'icon_background' | 'icon_type' | 'icon_url' | 'id' | 'mode' | 'name'
  >
  onClose: () => void
}

const SwitchAppModal = ({ show, sourceApp, onClose }: SwitchAppModalProps) => {
  const { push, replace } = useRouter()
  const nameInputId = useId()
  const { t } = useTranslation(['app', 'common'])
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const isRbacEnabled = systemFeatures.rbac_enabled

  const deploymentEdition = systemFeatures.deployment_edition
  const { data: appQuota } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: (data) => data.apps,
    }),
  )
  const isAppQuotaUnavailable = deploymentEdition === 'CLOUD' && appQuota === undefined
  // A limit of 0 means unlimited.
  const isAppsFull =
    deploymentEdition === 'CLOUD' &&
    appQuota !== undefined &&
    appQuota.limit > 0 &&
    appQuota.size >= appQuota.limit

  const appIconType = zIconType.safeParse(sourceApp.icon_type).data
  const [appIcon, setAppIcon] = useState(
    appIconType === 'image'
      ? { type: 'image' as const, url: sourceApp.icon_url ?? '', fileId: sourceApp.icon ?? '' }
      : {
          type: 'emoji' as const,
          icon: sourceApp.icon ?? '',
          background: sourceApp.icon_background,
        },
  )

  const [name, setName] = useState(`${sourceApp.name}(copy)`)
  const [removeOriginal, setRemoveOriginal] = useState<boolean>(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const { mutateAsync: convertToWorkflow } = useMutation(
    consoleQuery.apps.byAppId.convertToWorkflow.post.mutationOptions(),
  )
  const { mutateAsync: deleteOriginalApp } = useMutation(
    consoleQuery.apps.byAppId.delete.mutationOptions(),
  )

  const goStart = async () => {
    if (isAppQuotaUnavailable || isAppsFull) return
    try {
      const { new_app_id: newAppID, permission_keys } = await convertToWorkflow({
        params: { app_id: sourceApp.id },
        body: {
          name,
          icon_type: appIcon.type,
          icon: appIcon.type === 'emoji' ? appIcon.icon : appIcon.fileId,
          icon_background: appIcon.type === 'emoji' ? appIcon.background : undefined,
        },
      })
      onClose()
      if (removeOriginal)
        await deleteOriginalApp({
          params: { app_id: sourceApp.id },
        })
      getRedirection(
        {
          id: newAppID,
          mode: sourceApp.mode === 'completion' ? 'workflow' : 'advanced-chat',
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
      <Dialog
        open={show}
        disablePointerDismissal
        onOpenChange={(open) => {
          if (!open && !showConfirmDelete) onClose()
        }}
      >
        <DialogContent className="w-150 max-w-150">
          <DialogHeader>
            <div className="mb-2 h-12 w-12 rounded-xl border-[0.5px] border-divider-regular bg-background-default-burn p-3 shadow-xl">
              <span
                aria-hidden
                className="i-custom-vender-solid-alertsAndFeedback-alert-triangle size-6 text-[rgb(247,144,9)]"
              />
            </div>
            <DialogTitle>{t(($) => $.switch, { ns: 'app' })}</DialogTitle>
            <DialogDescription>
              <span>{t(($) => $.switchTipStart, { ns: 'app' })}</span>
              <span className="font-medium text-text-secondary">
                {t(($) => $.switchTip, { ns: 'app' })}
              </span>
              <span>{t(($) => $.switchTipEnd, { ns: 'app' })}</span>
            </DialogDescription>
            <DialogCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
          </DialogHeader>
          <DialogBody>
            <label
              htmlFor={nameInputId}
              className="block py-2 text-sm leading-5 font-medium text-text-primary"
            >
              {t(($) => $.switchLabel, { ns: 'app' })}
            </label>
            <div className="flex items-center justify-between space-x-2">
              <IconPicker value={appIcon} onValueChange={setAppIcon}>
                <IconPickerTrigger
                  aria-label={t(($) => $['iconPicker.title'], { ns: 'app' })}
                  className="shrink-0 cursor-pointer rounded-[10px]"
                >
                  <IconPickerIcon size="large" />
                </IconPickerTrigger>
                <IconPickerContent />
              </IconPicker>
              <Input
                id={nameInputId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t(($) => $['newApp.appNamePlaceholder'], { ns: 'app' }) || ''}
                className="h-10 grow"
              />
            </div>
            {isAppsFull && <AppsFull className="mt-4" loc="app-switch" />}
          </DialogBody>
          <DialogFooter>
            <div className="me-auto flex items-center">
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
            <Button onClick={onClose}>{t(($) => $['newApp.Cancel'], { ns: 'app' })}</Button>
            <Button
              className="inset-ring-red-700"
              disabled={isAppQuotaUnavailable || isAppsFull || !name}
              variant="primary"
              tone="destructive"
              onClick={goStart}
            >
              {t(($) => $.switchStart, { ns: 'app' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={showConfirmDelete} onOpenChange={handleConfirmDeleteOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(($) => $.deleteAppConfirmTitle, { ns: 'app' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.deleteAppConfirmContent, { ns: 'app' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={() => setShowConfirmDelete(false)}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default SwitchAppModal
