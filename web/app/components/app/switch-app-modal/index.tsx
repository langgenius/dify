'use client'

import type {
  AppPartial,
  ConvertToWorkflowPayload,
} from '@dify/contracts/api/console/apps/types.gen'
import type { DialogActions, DialogProps } from '@langgenius/dify-ui/dialog'
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
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
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

type SwitchAppModalProps = Pick<DialogProps, 'open' | 'onOpenChange'> & {
  sourceApp: Pick<
    AppPartial,
    'icon' | 'icon_background' | 'icon_type' | 'icon_url' | 'id' | 'mode' | 'name'
  >
}

const SwitchAppModal = ({ open, sourceApp, onOpenChange }: SwitchAppModalProps) => {
  const nameInputRef = useRef<HTMLInputElement>(null)
  const actionsRef = useRef<DialogActions>(null)
  const { t } = useTranslation(['app'])
  const { push, replace } = useRouter()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const conversion = useMutation(consoleQuery.apps.byAppId.convertToWorkflow.post.mutationOptions())
  const deletion = useMutation(consoleQuery.apps.byAppId.delete.mutationOptions())
  const isPending = conversion.isPending || deletion.isPending
  const submit = (body: ConvertToWorkflowPayload, removeOriginal: boolean) => {
    if (isPending) return
    conversion.mutate(
      { params: { app_id: sourceApp.id }, body },
      {
        onError: () => toast.error(t(($) => $['newApp.appCreateFailed'], { ns: 'app' })),
        onSuccess: ({ new_app_id, permission_keys }) => {
          const finish = (removed: boolean) => {
            actionsRef.current?.close()
            getRedirection(
              {
                id: new_app_id,
                mode: sourceApp.mode === 'completion' ? 'workflow' : 'advanced-chat',
                permission_keys,
              },
              removed ? replace : push,
              { isRbacEnabled: systemFeatures.rbac_enabled },
            )
          }
          if (removeOriginal) {
            deletion.mutate(
              { params: { app_id: sourceApp.id } },
              {
                onSuccess: () => finish(true),
                onError: () => {
                  toast.error(t(($) => $.appDeleteFailed, { ns: 'app' }))
                  finish(false)
                },
              },
            )
          } else finish(false)
        },
      },
    )
  }
  return (
    <Dialog
      actionsRef={actionsRef}
      open={open}
      disablePointerDismissal
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && isPending && details.reason !== 'imperative-action') details.cancel()
        else onOpenChange?.(nextOpen, details)
      }}
    >
      <DialogContent initialFocus={nameInputRef} className="w-150 max-w-150">
        <SwitchAppSession
          nameInputRef={nameInputRef}
          sourceApp={sourceApp}
          onSubmit={submit}
          isPending={isPending}
        />
      </DialogContent>
    </Dialog>
  )
}

function SwitchAppSession({
  nameInputRef,
  sourceApp,
  onSubmit,
  isPending,
}: Pick<SwitchAppModalProps, 'sourceApp'> & {
  nameInputRef: React.RefObject<HTMLInputElement | null>
  onSubmit: (body: ConvertToWorkflowPayload, removeOriginal: boolean) => void
  isPending: boolean
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const { t } = useTranslation(['app', 'common', 'explore'])
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())

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

  const [removeOriginal, setRemoveOriginal] = useState<boolean>(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
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

  const handleConfirmDeleteOpenChange = (open: boolean) => {
    if (open) return

    setShowConfirmDelete(false)
    setRemoveOriginal(false)
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
          <DialogCloseButton
            disabled={isPending}
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          />
        </DialogHeader>
        <DialogBody>
          <IconPicker value={appIcon} onValueChange={setAppIcon}>
            <Field
              name="name"
              validate={(value) =>
                typeof value === 'string' && !value.trim()
                  ? t(($) => $['appCustomize.nameRequired'], { ns: 'explore' })
                  : null
              }
            >
              <FieldLabel className="block py-2 text-sm leading-5 font-medium text-text-primary">
                {t(($) => $.switchLabel, { ns: 'app' })}
              </FieldLabel>
              <div className="flex items-center justify-between space-x-2">
                <IconPickerTrigger
                  disabled={isPending}
                  aria-label={t(($) => $['iconPicker.title'], { ns: 'app' })}
                  className="shrink-0 cursor-pointer rounded-[10px]"
                >
                  <IconPickerIcon size="large" />
                </IconPickerTrigger>
                <Input
                  ref={nameInputRef}
                  required
                  readOnly={isPending}
                  defaultValue={`${sourceApp.name}(copy)`}
                  placeholder={t(($) => $['newApp.appNamePlaceholder'], { ns: 'app' }) || ''}
                  className="h-10 grow"
                />
              </div>
              <FieldError />
            </Field>
            <IconPickerContent />
          </IconPicker>
          {isAppsFull && <AppsFull className="mt-4" loc="app-switch" />}
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
                  if (checked) setShowConfirmDelete(true)
                }}
              />
              <span className="ml-2 text-left text-sm/5 text-text-secondary">
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
