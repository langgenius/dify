'use client'

import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import type { ConsoleClient } from '@/service/console'
import { zIconType } from '@dify/contracts/api/console/apps/zod.gen'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
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
import { AppModeEnum } from '@/types/app'
import { getRedirection } from '@/utils/app-redirection'

type SwitchAppDialogProps = {
  open: boolean
  sourceApp: Pick<
    AppPartial,
    'icon' | 'icon_background' | 'icon_type' | 'icon_url' | 'id' | 'mode' | 'name'
  >
  onOpenChange: (open: boolean) => void
}

type ConvertToWorkflow = ConsoleClient['apps']['byAppId']['convertToWorkflow']['post']

type SwitchAppFormProps = Pick<SwitchAppDialogProps, 'sourceApp'> & {
  onClose: () => void
  isPending: boolean
  convertToWorkflow: (input: Parameters<ConvertToWorkflow>[0]) => ReturnType<ConvertToWorkflow>
}

function SwitchAppForm({ sourceApp, onClose, isPending, convertToWorkflow }: SwitchAppFormProps) {
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
  const { mutateAsync: deleteOriginalApp } = useMutation(
    consoleQuery.apps.byAppId.delete.mutationOptions(),
  )

  const goStart = async () => {
    if (isPending || !name || isAppQuotaUnavailable || isAppsFull) return
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
      toast.success(t(($) => $['newApp.appCreated'], { ns: 'app' }))
      if (removeOriginal)
        await deleteOriginalApp({
          params: { app_id: sourceApp.id },
        })
      getRedirection(
        {
          id: newAppID,
          mode:
            sourceApp.mode === AppModeEnum.COMPLETION
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
      <form
        onSubmit={(event) => {
          if (event.target !== event.currentTarget) return
          event.preventDefault()
          void goStart()
        }}
      >
        <DialogClose
          disabled={isPending}
          render={
            <IconButton
              size="lg"
              className="absolute top-4 right-4"
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            >
              <span aria-hidden className="i-ri-close-line size-4 text-text-tertiary" />
            </IconButton>
          }
        />
        <div className="h-12 w-12 rounded-xl border-[0.5px] border-divider-regular bg-background-default-burn p-3 shadow-xl">
          <span
            aria-hidden
            className="i-custom-vender-solid-alertsAndFeedback-alert-triangle size-6 text-[rgb(247,144,9)]"
          />
        </div>
        <DialogTitle className="relative mt-3 text-xl leading-7.5 font-semibold text-text-primary">
          {t(($) => $.switch, { ns: 'app' })}
        </DialogTitle>
        <DialogDescription className="my-1 text-sm/5 text-text-tertiary">
          <span>{t(($) => $.switchTipStart, { ns: 'app' })}</span>
          <span className="font-medium text-text-secondary">
            {t(($) => $.switchTip, { ns: 'app' })}
          </span>
          <span>{t(($) => $.switchTipEnd, { ns: 'app' })}</span>
        </DialogDescription>
        <div className="pb-4">
          <label
            htmlFor={nameInputId}
            className="block py-2 text-sm leading-5 font-medium text-text-primary"
          >
            {t(($) => $.switchLabel, { ns: 'app' })}
          </label>
          <div className="flex items-center justify-between space-x-2">
            <IconPicker value={appIcon} onValueChange={setAppIcon}>
              <IconPickerTrigger
                disabled={isPending}
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
              readOnly={isPending}
              onChange={(e) => setName(e.target.value)}
              placeholder={t(($) => $['newApp.appNamePlaceholder'], { ns: 'app' }) || ''}
              className="h-10 grow"
            />
          </div>
        </div>
        {isAppsFull && <AppsFull loc="app-switch" />}
        <div className="flex items-center justify-between pt-6">
          <div className="flex items-center">
            <label className="flex cursor-pointer items-center">
              <Checkbox
                className="shrink-0"
                checked={removeOriginal}
                disabled={isPending}
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
            <DialogClose disabled={isPending} render={<Button className="mr-2" />}>
              {t(($) => $['newApp.Cancel'], { ns: 'app' })}
            </DialogClose>
            <Button
              className="inset-ring-red-700"
              disabled={isAppQuotaUnavailable || isAppsFull || !name}
              variant="primary"
              tone="destructive"
              type="submit"
              loading={isPending}
            >
              {t(($) => $.switchStart, { ns: 'app' })}
            </Button>
          </div>
        </div>
      </form>
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

export function SwitchAppDialog({ open, sourceApp, onOpenChange }: SwitchAppDialogProps) {
  const { mutateAsync: convertToWorkflow, isPending } = useMutation(
    consoleQuery.apps.byAppId.convertToWorkflow.post.mutationOptions(),
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && isPending) {
          details.cancel()
          return
        }
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="w-150 max-w-150 overflow-hidden border-none p-8 text-left align-middle">
        <SwitchAppForm
          sourceApp={sourceApp}
          onClose={() => onOpenChange(false)}
          isPending={isPending}
          convertToWorkflow={convertToWorkflow}
        />
      </DialogContent>
    </Dialog>
  )
}
