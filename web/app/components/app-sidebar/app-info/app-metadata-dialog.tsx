import type {
  AppDetailWithSite,
  UpdateAppPayload,
} from '@dify/contracts/api/console/apps/types.gen'
import type { DialogActions, DialogProps } from '@langgenius/dify-ui/dialog'
import type { IconPickerInputValue, IconPickerValue } from '@/app/components/base/icon-picker'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { Switch } from '@langgenius/dify-ui/switch'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
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
import { updateCachedAppMetadata } from './metadata'

type AppMetadataDialogProps = Pick<DialogProps, 'open' | 'onOpenChange'> & {
  appDetail: AppDetailWithSite
  operation: 'edit' | 'duplicate'
}

export function AppMetadataDialog({
  appDetail,
  operation,
  open,
  onOpenChange,
}: AppMetadataDialogProps) {
  const actionsRef = useRef<DialogActions>(null)
  const { t } = useTranslation(['app'])
  const nameInputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const { replace } = useRouter()
  const { data: features } = useSuspenseQuery(systemFeaturesQueryOptions())
  const edit = useMutation(
    consoleQuery.apps.byAppId.put.mutationOptions({
      onSuccess: (app) => {
        queryClient.setQueryData(
          consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: appDetail.id } } }),
          (cached) => updateCachedAppMetadata(cached, app),
        )
        void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
        void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.starred.get.key() })
        void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.recent.get.key() })
        actionsRef.current?.close()
        void import('@/app/components/workflow/collaboration/core/websocket-manager')
          .then(({ webSocketClient }) => {
            webSocketClient.getSocket(appDetail.id)?.emit('collaboration_event', {
              type: 'app_meta_update',
              data: { timestamp: Date.now() },
              timestamp: Date.now(),
            })
          })
          .catch(() => {})
      },
      onError: () => toast.error(t(($) => $.editFailed, { ns: 'app' })),
    }),
  )
  const copy = useMutation(
    consoleQuery.apps.byAppId.copy.post.mutationOptions({
      onError: () => toast.error(t(($) => $['newApp.appCreateFailed'], { ns: 'app' })),
    }),
  )
  const isPending = edit.isPending || copy.isPending
  const submit = (body: UpdateAppPayload) => {
    if (isPending) return
    if (operation === 'edit') edit.mutate({ params: { app_id: appDetail.id }, body })
    else
      copy.mutate(
        {
          params: { app_id: appDetail.id },
          body: {
            name: body.name,
            icon_type: body.icon_type,
            icon: body.icon,
            icon_background: body.icon_background,
          },
        },
        {
          onSuccess: (app) => {
            if (!('mode' in app)) {
              toast.error(t(($) => $['newApp.appCreateFailed'], { ns: 'app' }))
              return
            }
            actionsRef.current?.close()
            toast.success(t(($) => $['newApp.appCreated'], { ns: 'app' }))
            getRedirection(app, replace, { isRbacEnabled: features.rbac_enabled })
          },
        },
      )
  }
  return (
    <Dialog
      actionsRef={actionsRef}
      open={open}
      disablePointerDismissal={operation === 'edit'}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && isPending && details.reason !== 'imperative-action') details.cancel()
        else onOpenChange?.(nextOpen, details)
      }}
    >
      <DialogContent initialFocus={nameInputRef}>
        <AppMetadataForm
          nameInputRef={nameInputRef}
          appDetail={appDetail}
          operation={operation}
          isPending={isPending}
          onSubmit={submit}
        />
      </DialogContent>
    </Dialog>
  )
}

type AppMetadataFormProps = Pick<AppMetadataDialogProps, 'appDetail' | 'operation'> & {
  nameInputRef: React.RefObject<HTMLInputElement | null>
  isPending: boolean
  onSubmit: (body: UpdateAppPayload) => void
}

function AppMetadataForm({
  appDetail,
  operation,
  nameInputRef,
  isPending,
  onSubmit,
}: AppMetadataFormProps) {
  const { t } = useTranslation(['app', 'common', 'explore'])
  const formRef = useRef<HTMLFormElement>(null)
  const [source] = useState(appDetail)
  const [selectedIcon, setSelectedIcon] = useState<IconPickerValue | null>(null)
  const { data: features } = useSuspenseQuery(systemFeaturesQueryOptions())
  const isEdit = operation === 'edit'
  const { data: quota } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: !isEdit && features.deployment_edition === 'CLOUD',
      select: (data) => data.apps,
    }),
  )
  const quotaUnavailable = !isEdit && features.deployment_edition === 'CLOUD' && !quota
  const isFull = !isEdit && !!quota && quota.limit > 0 && quota.size >= quota.limit
  const icon: IconPickerInputValue | undefined =
    selectedIcon ??
    (source.icon_type === 'image' && source.icon
      ? { type: 'image', fileId: source.icon, url: source.icon_url ?? '' }
      : source.icon_type === 'emoji' && source.icon
        ? { type: 'emoji', icon: source.icon, background: source.icon_background }
        : source.icon_type === 'link' && source.icon
          ? { type: 'link', url: source.icon }
          : undefined)
  return (
    <Form
      className="contents"
      ref={formRef}
      onFormSubmit={(values, details) => {
        if (details.event.target !== formRef.current) return
        const name = String(values.name ?? '')
        if (isPending || quotaUnavailable || isFull || !name.trim()) return
        const body: UpdateAppPayload = {
          name,
          icon_type: selectedIcon?.type ?? source.icon_type,
          icon: selectedIcon
            ? selectedIcon.type === 'emoji'
              ? selectedIcon.icon
              : selectedIcon.fileId
            : source.icon,
          icon_background: selectedIcon
            ? selectedIcon.type === 'emoji'
              ? selectedIcon.background
              : undefined
            : source.icon_background,
        }
        if (isEdit) {
          body.description = String(values.description ?? '')
          body.use_icon_as_answer_icon =
            typeof values.use_icon_as_answer_icon === 'boolean'
              ? values.use_icon_as_answer_icon
              : source.use_icon_as_answer_icon
          if (values.max_active_requests !== '' && values.max_active_requests !== undefined)
            body.max_active_requests = Number(values.max_active_requests)
        }
        onSubmit(body)
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {isEdit
            ? t(($) => $.editAppTitle, { ns: 'app' })
            : t(($) => $.duplicateTitle, { ns: 'app' })}
        </DialogTitle>
        <DialogHeaderCloseButton
          disabled={isPending}
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
        />
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        <Fieldset className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
          <FieldsetLegend className="col-span-2 mb-0">
            {t(($) => $['newApp.captionName'], { ns: 'app' })}
          </FieldsetLegend>
          <IconPicker value={icon} onValueChange={setSelectedIcon}>
            <IconPickerTrigger
              disabled={isPending}
              aria-label={t(($) => $['iconPicker.title'], { ns: 'app' })}
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
              defaultValue={source.name}
              readOnly={isPending}
              required
            />
            <FieldError className="col-span-2" />
          </Field>
        </Fieldset>
        {isEdit && (
          <>
            <Field name="description">
              <FieldLabel>{t(($) => $['newApp.captionDescription'], { ns: 'app' })}</FieldLabel>
              <Textarea defaultValue={source.description} readOnly={isPending} />
            </Field>
            {(source.mode === 'chat' ||
              source.mode === 'advanced-chat' ||
              source.mode === 'agent-chat') && (
              <Field name="use_icon_as_answer_icon">
                <FieldLabel>{t(($) => $['answerIcon.title'], { ns: 'app' })}</FieldLabel>
                <Switch defaultChecked={source.use_icon_as_answer_icon} disabled={isPending} />
                <FieldDescription>
                  {t(($) => $['answerIcon.descriptionInExplore'], { ns: 'app' })}
                </FieldDescription>
              </Field>
            )}
            <Field name="max_active_requests">
              <FieldLabel>{t(($) => $.maxActiveRequests, { ns: 'app' })}</FieldLabel>
              <Input
                type="number"
                min={0}
                defaultValue={source.max_active_requests ?? ''}
                readOnly={isPending}
              />
              <FieldDescription>{t(($) => $.maxActiveRequestsTip, { ns: 'app' })}</FieldDescription>
              <FieldError />
            </Field>
          </>
        )}
        {isFull && <AppsFull loc="app-duplicate-create" />}
      </DialogBody>
      <DialogFooter>
        <DialogClose disabled={isPending} render={<Button type="button" />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button
          type="submit"
          variant="primary"
          loading={isPending}
          disabled={quotaUnavailable || isFull}
        >
          {isEdit
            ? t(($) => $['operation.save'], { ns: 'common' })
            : t(($) => $.duplicate, { ns: 'app' })}
        </Button>
      </DialogFooter>
    </Form>
  )
}
