'use client'
import type { FormRefObject, FormSchema } from '@/app/components/base/form/types'
import type { ParametersSchema, PluginDetail } from '@/app/components/plugins/types'
import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { isEqual } from 'es-toolkit/predicate'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { BaseForm } from '@/app/components/base/form/components/base'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { ReadmeEntrance } from '@/app/components/plugins/readme-panel/entrance'
import { toast } from '@/app/notifications'
import { useUpdateTriggerSubscription } from '@/service/use-triggers'
import { getErrorMessage } from '@/utils/error-message'
import { usePluginStore } from '../../store'
import { useSubscriptionList } from '../use-subscription-list'

type Props = Readonly<{
  onClose: () => void
  subscription: TriggerSubscription
  pluginDetail?: PluginDetail
}>

const normalizeFormType = (type: string): FormTypeEnum => {
  switch (type) {
    case 'string':
    case 'text':
      return FormTypeEnum.textInput
    case 'password':
    case 'secret':
      return FormTypeEnum.secretInput
    case 'number':
    case 'integer':
      return FormTypeEnum.textNumber
    case 'boolean':
      return FormTypeEnum.boolean
    case 'select':
      return FormTypeEnum.select
    default:
      if (Object.values(FormTypeEnum).includes(type as FormTypeEnum)) return type as FormTypeEnum
      return FormTypeEnum.textInput
  }
}

export const ManualEditModal = ({ onClose, subscription, pluginDetail }: Props) => {
  const { t } = useTranslation(['common', 'pluginTrigger'])
  const detail = usePluginStore((state) => state.detail)
  const { refetch } = useSubscriptionList()

  const { mutate: updateSubscription, isPending: isUpdating } = useUpdateTriggerSubscription()

  const propertiesSchema = useMemo<ParametersSchema[]>(
    () => detail?.declaration?.trigger?.subscription_schema || [],
    [detail?.declaration?.trigger?.subscription_schema],
  )

  const formRef = useRef<FormRefObject>(null)

  const handleConfirm = () => {
    const formValues = formRef.current?.getFormValues({
      needTransformWhenSecretFieldIsPristine: true,
    })
    if (!formValues?.isCheckValidated) return

    const name = formValues.values.subscription_name as string

    // Extract properties (exclude subscription_name and callback_url)
    const newProperties = { ...formValues.values }
    delete newProperties.subscription_name
    delete newProperties.callback_url

    // Only send properties if changed
    const hasChanged = !isEqual(newProperties, subscription.properties || {})
    const properties = hasChanged ? newProperties : undefined

    updateSubscription(
      {
        subscriptionId: subscription.id,
        name,
        properties,
      },
      {
        onSuccess: () => {
          refetch?.()
          onClose()
        },
        onError: (error: unknown) => {
          toast.error(
            getErrorMessage(error) ??
              t(($) => $['subscription.list.item.actions.edit.error'], { ns: 'pluginTrigger' }),
          )
        },
      },
    )
  }

  const formSchemas: FormSchema[] = useMemo(
    () => [
      {
        name: 'subscription_name',
        label: t(($) => $['modal.form.subscriptionName.label'], { ns: 'pluginTrigger' }),
        placeholder: t(($) => $['modal.form.subscriptionName.placeholder'], {
          ns: 'pluginTrigger',
        }),
        type: FormTypeEnum.textInput,
        required: true,
        default: subscription.name,
      },
      {
        name: 'callback_url',
        label: t(($) => $['modal.form.callbackUrl.label'], { ns: 'pluginTrigger' }),
        placeholder: t(($) => $['modal.form.callbackUrl.placeholder'], { ns: 'pluginTrigger' }),
        type: FormTypeEnum.textInput,
        required: false,
        default: subscription.endpoint || '',
        disabled: true,
        tooltip: t(($) => $['modal.form.callbackUrl.tooltip'], { ns: 'pluginTrigger' }),
        showCopy: true,
      },
      ...propertiesSchema.map((schema: ParametersSchema) => ({
        ...schema,
        type: normalizeFormType(schema.type as string),
        tooltip: schema.description,
        default: subscription.properties?.[schema.name] || schema.default,
      })),
    ],
    [t, subscription.name, subscription.endpoint, subscription.properties, propertiesSchema],
  )

  const title = t(($) => $['subscription.list.item.actions.edit.title'], { ns: 'pluginTrigger' })
  const confirmButtonText = isUpdating
    ? t(($) => $['operation.saving'], { ns: 'common' })
    : t(($) => $['operation.save'], { ns: 'common' })

  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent backdropProps={{ forceRender: true }}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody>
          {pluginDetail && <ReadmeEntrance pluginDetail={pluginDetail} presentation="dialog" />}
          <BaseForm
            formSchemas={formSchemas}
            ref={formRef}
            labelClassName="system-sm-medium mb-2 flex items-center gap-1 text-text-primary"
            formClassName="space-y-4"
          />
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose} disabled={isUpdating}>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </Button>
          <Button variant="primary" onClick={handleConfirm} disabled={isUpdating}>
            {confirmButtonText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
