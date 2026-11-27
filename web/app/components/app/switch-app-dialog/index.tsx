'use client'

import type {
  AppPartial,
  ConvertToWorkflowPayload,
} from '@dify/contracts/api/console/apps/types.gen'
import type { RefObject } from 'react'
import { zIconType } from '@dify/contracts/api/console/apps/zod.gen'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  createAlertDialogHandle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import {
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldError } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconPicker,
  IconPickerContent,
  IconPickerIcon,
  IconPickerTrigger,
} from '@/app/components/base/icon-picker'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { getCountQuota, isQuotaReached } from '@/app/components/billing/quota'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'

export type SwitchAppSource = Pick<
  AppPartial,
  'icon' | 'icon_background' | 'icon_type' | 'icon_url' | 'id' | 'mode' | 'name'
>

type SwitchAppDialogContentProps = {
  sourceApp: SwitchAppSource
  isPending: boolean
  onSubmit: (body: ConvertToWorkflowPayload, removeOriginal: boolean) => void
}

export function SwitchAppDialogContent({
  sourceApp,
  isPending,
  onSubmit,
}: SwitchAppDialogContentProps) {
  const nameInputRef = useRef<HTMLInputElement>(null)

  return (
    <DialogContent initialFocus={nameInputRef} className="w-150">
      <SwitchAppSession
        nameInputRef={nameInputRef}
        sourceApp={sourceApp}
        onSubmit={onSubmit}
        isPending={isPending}
      />
    </DialogContent>
  )
}

function SwitchAppSession({
  nameInputRef,
  sourceApp,
  onSubmit,
  isPending,
}: SwitchAppDialogContentProps & {
  nameInputRef: RefObject<HTMLInputElement | null>
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const { t } = useTranslation(['app', 'common', 'explore'])
  const appQuotaQuery = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (data) => getCountQuota(data.apps),
    }),
  )
  const appQuota = appQuotaQuery.data
  const isAppQuotaUnavailable = appQuota === undefined
  const isAppsFull = appQuota !== undefined && isQuotaReached(appQuota)
  const appQuotaLoad = useOwnedQueryError(appQuotaQuery)
  const appQuotaErrorMessage = useRequestErrorMessage(
    appQuotaLoad?.error,
    t(($) => $['api.actionFailed'], { ns: 'common' }),
  )

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

  const [removeOriginal, setRemoveOriginal] = useState<boolean>(false)
  const [confirmRemoveDialog] = useState(() => createAlertDialogHandle())
  const submit = (name: string) => {
    if (isPending || isAppQuotaUnavailable || isAppsFull || !name.trim()) return
    onSubmit(
      {
        name,
        icon_type: appIcon.type,
        icon: appIcon.type === 'emoji' ? appIcon.icon : appIcon.fileId,
        icon_background: appIcon.type === 'emoji' ? appIcon.background : undefined,
      },
      removeOriginal,
    )
  }

  return (
    <>
      <Form
        ref={formRef}
        className="contents"
        onFormSubmit={(values, details) => {
          if (details.event.target === formRef.current) submit(String(values.name ?? ''))
        }}
      >
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
          <DialogHeaderCloseButton
            disabled={isPending}
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          />
        </DialogHeader>
        <DialogBody>
          <Fieldset className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
            <FieldsetLegend className="col-span-2 mb-0 block py-2 text-sm leading-5 font-medium text-text-primary">
              {t(($) => $.switchLabel, { ns: 'app' })}
            </FieldsetLegend>
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
            <Field
              name="name"
              className="contents"
              validate={(value) =>
                typeof value === 'string' && !value.trim()
                  ? t(($) => $['appCustomize.nameRequired'], { ns: 'explore' })
                  : null
              }
            >
              <Input
                aria-label={t(($) => $['newApp.name'], { ns: 'app' })}
                ref={nameInputRef}
                required
                readOnly={isPending}
                defaultValue={`${sourceApp.name}(copy)`}
                placeholder={t(($) => $['newApp.appNamePlaceholder'], { ns: 'app' })}
                className="h-10 grow"
              />
              <FieldError className="col-span-2" />
            </Field>
          </Fieldset>
          {isAppsFull && <AppsFull className="mt-4" loc="app-switch" />}
          {appQuotaLoad && appQuotaErrorMessage && (
            <Alert type="error" className="mt-4">
              <AlertTitle>{appQuotaErrorMessage}</AlertTitle>
              <AlertActions>
                <Button size="small" loading={appQuotaLoad.retrying} onClick={appQuotaLoad.retry}>
                  {t(($) => $['operation.retry'], { ns: 'common' })}
                </Button>
              </AlertActions>
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <div className="me-auto flex items-center">
            <label className="flex cursor-pointer items-center">
              <Checkbox
                name="remove_original"
                className="shrink-0"
                disabled={isPending}
                checked={removeOriginal}
                onCheckedChange={(checked) => {
                  setRemoveOriginal(checked)
                  if (checked) confirmRemoveDialog.open(null)
                }}
              />
              <span className="ms-2 text-start text-sm/5 text-text-secondary">
                {t(($) => $.removeOriginal, { ns: 'app' })}
              </span>
            </label>
          </div>
          <DialogClose disabled={isPending} render={<Button type="button" />}>
            {t(($) => $['newApp.Cancel'], { ns: 'app' })}
          </DialogClose>
          <Button
            className="inset-ring-red-700"
            type="submit"
            loading={isPending}
            disabled={isAppQuotaUnavailable || isAppsFull}
            variant="primary"
            tone="destructive"
          >
            {t(($) => $.switchStart, { ns: 'app' })}
          </Button>
        </DialogFooter>
      </Form>
      <AlertDialog
        handle={confirmRemoveDialog}
        onOpenChange={(open, details) => {
          if (!open && details.reason !== 'imperative-action') setRemoveOriginal(false)
        }}
      >
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
            <AlertDialogConfirmButton onClick={() => confirmRemoveDialog.close()}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
