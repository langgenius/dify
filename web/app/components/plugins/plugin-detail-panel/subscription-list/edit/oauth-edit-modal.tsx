'use client'
import type { FormRefObject, FormSchema } from '@/app/components/base/form/types'
import type { ParametersSchema, PluginDetail } from '@/app/components/plugins/types'
import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import { isEqual } from 'es-toolkit/predicate'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { BaseForm } from '@/app/components/base/form/components/base'
import { FormTypeEnum } from '@/app/components/base/form/types'
import Modal from '@/app/components/base/modal/modal'
import Toast from '@/app/components/base/toast'
import { ReadmeEntrance } from '@/app/components/plugins/readme-panel/entrance'
import { useUpdateTriggerSubscription } from '@/service/use-triggers'
import { ReadmeShowType } from '../../../readme-panel/store'
import { usePluginStore } from '../../store'
import { useSubscriptionList } from '../use-subscription-list'

type Props = {
  onClose: () => void
  subscription: TriggerSubscription
  pluginDetail?: PluginDetail
}

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
      if (Object.values(FormTypeEnum).includes(type as FormTypeEnum))
        return type as FormTypeEnum
      return FormTypeEnum.textInput
  }
}

export const OAuthEditModal = ({ onClose, subscription, pluginDetail }: Props) => {
  const { t } = useTranslation()
  const detail = usePluginStore(state => state.detail)
  const { refetch } = useSubscriptionList()

  const { mutate: updateSubscription, isPending: isUpdating } = useUpdateTriggerSubscription()

  const getErrorMessage = (error: unknown, fallback: string) => {
    if (error instanceof Error && error.message)
      return error.message
    if (typeof error === 'object' && error && 'message' in error) {
      const message = (error as { message?: string }).message
      if (typeof message === 'string' && message)
        return message
    }
    return fallback
  }

  const parametersSchema = useMemo<ParametersSchema[]>(
    () => detail?.declaration?.trigger?.subscription_constructor?.parameters || [],
    [detail?.declaration?.trigger?.subscription_constructor?.parameters],
  )

  const formRef = useRef<FormRefObject>(null)

  const handleConfirm = () => {
    const formValues = formRef.current?.getFormValues({
      needTransformWhenSecretFieldIsPristine: true,
    })
    if (!formValues?.isCheckValidated)
      return

    const name = formValues.values.subscription_name as string

    // Extract parameters (exclude subscription_name and callback_url)
    const newParameters = { ...formValues.values }
    delete newParameters.subscription_name
    delete newParameters.callback_url

    // Only send parameters if changed
    const hasChanged = !isEqual(newParameters, subscription.parameters || {})
    const parameters = hasChanged ? newParameters : undefined

    updateSubscription(
      {
        subscriptionId: subscription.id,
        name,
        parameters,
      },
      {
        onSuccess: () => {
          Toast.notify({
            type: 'success',
            message: t('subscription.list.item.actions.edit.success', { ns: 'pluginTrigger' }),
          })
          refetch?.()
          onClose()
        },
        onError: (error: unknown) => {
          Toast.notify({
            type: 'error',
            message: getErrorMessage(error, t('subscription.list.item.actions.edit.error', { ns: 'pluginTrigger' })),
          })
        },
      },
    )
  }

  const formSchemas: FormSchema[] = useMemo(() => [
    {
      name: 'subscription_name',
      label: t('modal.form.subscriptionName.label', { ns: 'pluginTrigger' }),
      placeholder: t('modal.form.subscriptionName.placeholder', { ns: 'pluginTrigger' }),
      type: FormTypeEnum.textInput,
      required: true,
      default: subscription.name,
    },
    {
      name: 'callback_url',
      label: t('modal.form.callbackUrl.label', { ns: 'pluginTrigger' }),
      placeholder: t('modal.form.callbackUrl.placeholder', { ns: 'pluginTrigger' }),
      type: FormTypeEnum.textInput,
      required: false,
      default: subscription.endpoint || '',
      disabled: true,
      tooltip: t('modal.form.callbackUrl.tooltip', { ns: 'pluginTrigger' }),
      showCopy: true,
    },
    ...parametersSchema.map((schema: ParametersSchema) => {
      const normalizedType = normalizeFormType(schema.type as string)
      return {
        ...schema,
        type: normalizedType,
        tooltip: schema.description,
        default: subscription.parameters?.[schema.name] || schema.default,
        dynamicSelectParams: normalizedType === FormTypeEnum.dynamicSelect
          ? {
              plugin_id: detail?.plugin_id || '',
              provider: detail?.provider || '',
              action: 'provider',
              parameter: schema.name,
              credential_id: subscription.id,
            }
          : undefined,
        fieldClassName: schema.type === FormTypeEnum.boolean ? 'flex items-center justify-between' : undefined,
        labelClassName: schema.type === FormTypeEnum.boolean ? 'mb-0' : undefined,
      }
    }),
  ], [t, subscription.name, subscription.endpoint, subscription.parameters, subscription.id, parametersSchema, detail?.plugin_id, detail?.provider])

  return (
    <Modal
      title={t('subscription.list.item.actions.edit.title', { ns: 'pluginTrigger' })}
      confirmButtonText={isUpdating ? t('operation.saving', { ns: 'common' }) : t('operation.save', { ns: 'common' })}
      onClose={onClose}
      onCancel={onClose}
      onConfirm={handleConfirm}
      disabled={isUpdating}
      clickOutsideNotClose
      wrapperClassName="!z-[101]"
    >
      {pluginDetail && (
        <ReadmeEntrance pluginDetail={pluginDetail} showType={ReadmeShowType.modal} />
      )}
      <BaseForm
        formSchemas={formSchemas}
        ref={formRef}
        labelClassName="system-sm-medium mb-2 flex items-center gap-1 text-text-primary"
        formClassName="space-y-4"
      />
    </Modal>
  )
}
