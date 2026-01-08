'use client'
import type { FormRefObject, FormSchema } from '@/app/components/base/form/types'
import type { ParametersSchema, PluginDetail } from '@/app/components/plugins/types'
import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import { isEqual } from 'es-toolkit/predicate'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EncryptedBottom } from '@/app/components/base/encrypted-bottom'
import { BaseForm } from '@/app/components/base/form/components/base'
import { FormTypeEnum } from '@/app/components/base/form/types'
import Modal from '@/app/components/base/modal/modal'
import Toast from '@/app/components/base/toast'
import { ReadmeEntrance } from '@/app/components/plugins/readme-panel/entrance'
import { useUpdateTriggerSubscription, useVerifyTriggerSubscription } from '@/service/use-triggers'
import { parsePluginErrorMessage } from '@/utils/error-parser'
import { ReadmeShowType } from '../../../readme-panel/store'
import { usePluginStore } from '../../store'
import { useSubscriptionList } from '../use-subscription-list'

type Props = {
  onClose: () => void
  subscription: TriggerSubscription
  pluginDetail?: PluginDetail
}

enum EditStep {
  EditCredentials = 'edit_credentials',
  EditConfiguration = 'edit_configuration',
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

const HIDDEN_SECRET_VALUE = '[__HIDDEN__]'

// Check if all credential values are hidden (meaning nothing was changed)
const areAllCredentialsHidden = (credentials: Record<string, unknown>): boolean => {
  return Object.values(credentials).every(value => value === HIDDEN_SECRET_VALUE)
}

const StatusStep = ({ isActive, text, onClick, clickable }: {
  isActive: boolean
  text: string
  onClick?: () => void
  clickable?: boolean
}) => {
  return (
    <div
      className={`system-2xs-semibold-uppercase flex items-center gap-1 ${isActive
        ? 'text-state-accent-solid'
        : 'text-text-tertiary'} ${clickable ? 'cursor-pointer hover:text-text-secondary' : ''}`}
      onClick={clickable ? onClick : undefined}
    >
      {isActive && (
        <div className="h-1 w-1 rounded-full bg-state-accent-solid"></div>
      )}
      {text}
    </div>
  )
}

const MultiSteps = ({ currentStep, onStepClick }: { currentStep: EditStep, onStepClick?: (step: EditStep) => void }) => {
  const { t } = useTranslation()
  return (
    <div className="mb-6 flex w-1/3 items-center gap-2">
      <StatusStep
        isActive={currentStep === EditStep.EditCredentials}
        text={t('modal.steps.verify', { ns: 'pluginTrigger' })}
        onClick={() => onStepClick?.(EditStep.EditCredentials)}
        clickable={currentStep === EditStep.EditConfiguration}
      />
      <div className="h-px w-3 shrink-0 bg-divider-deep"></div>
      <StatusStep
        isActive={currentStep === EditStep.EditConfiguration}
        text={t('modal.steps.configuration', { ns: 'pluginTrigger' })}
      />
    </div>
  )
}

export const ApiKeyEditModal = ({ onClose, subscription, pluginDetail }: Props) => {
  const { t } = useTranslation()
  const detail = usePluginStore(state => state.detail)
  const { refetch } = useSubscriptionList()

  const [currentStep, setCurrentStep] = useState<EditStep>(EditStep.EditCredentials)
  const [verifiedCredentials, setVerifiedCredentials] = useState<Record<string, unknown> | null>(null)

  const { mutate: updateSubscription, isPending: isUpdating } = useUpdateTriggerSubscription()
  const { mutate: verifyCredentials, isPending: isVerifying } = useVerifyTriggerSubscription()

  const parametersSchema = useMemo<ParametersSchema[]>(
    () => detail?.declaration?.trigger?.subscription_constructor?.parameters || [],
    [detail?.declaration?.trigger?.subscription_constructor?.parameters],
  )

  const apiKeyCredentialsSchema = useMemo(() => {
    const rawSchema = detail?.declaration?.trigger?.subscription_constructor?.credentials_schema || []
    return rawSchema.map(schema => ({
      ...schema,
      tooltip: schema.help,
    }))
  }, [detail?.declaration?.trigger?.subscription_constructor?.credentials_schema])

  const basicFormRef = useRef<FormRefObject>(null)
  const parametersFormRef = useRef<FormRefObject>(null)
  const credentialsFormRef = useRef<FormRefObject>(null)

  const handleVerifyCredentials = () => {
    const credentialsFormValues = credentialsFormRef.current?.getFormValues({
      needTransformWhenSecretFieldIsPristine: true,
    }) || { values: {}, isCheckValidated: false }

    if (!credentialsFormValues.isCheckValidated)
      return

    const credentials = credentialsFormValues.values

    verifyCredentials(
      {
        provider: subscription.provider,
        subscriptionId: subscription.id,
        credentials,
      },
      {
        onSuccess: () => {
          Toast.notify({
            type: 'success',
            message: t('modal.apiKey.verify.success', { ns: 'pluginTrigger' }),
          })
          // Only save credentials if any field was modified (not all hidden)
          setVerifiedCredentials(areAllCredentialsHidden(credentials) ? null : credentials)
          setCurrentStep(EditStep.EditConfiguration)
        },
        onError: async (error: unknown) => {
          const errorMessage = await parsePluginErrorMessage(error) || t('modal.apiKey.verify.error', { ns: 'pluginTrigger' })
          Toast.notify({
            type: 'error',
            message: errorMessage,
          })
        },
      },
    )
  }

  const handleUpdate = () => {
    const basicFormValues = basicFormRef.current?.getFormValues({})
    if (!basicFormValues?.isCheckValidated)
      return

    const name = basicFormValues.values.subscription_name as string

    let parameters: Record<string, unknown> | undefined

    if (parametersSchema.length > 0) {
      const paramsFormValues = parametersFormRef.current?.getFormValues({
        needTransformWhenSecretFieldIsPristine: true,
      })
      if (!paramsFormValues?.isCheckValidated)
        return

      // Only send parameters if changed
      const hasChanged = !isEqual(paramsFormValues.values, subscription.parameters || {})
      parameters = hasChanged ? paramsFormValues.values : undefined
    }

    updateSubscription(
      {
        subscriptionId: subscription.id,
        name,
        parameters,
        credentials: verifiedCredentials || undefined,
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
        onError: async (error: unknown) => {
          const errorMessage = await parsePluginErrorMessage(error) || t('subscription.list.item.actions.edit.error', { ns: 'pluginTrigger' })
          Toast.notify({
            type: 'error',
            message: errorMessage,
          })
        },
      },
    )
  }

  const handleConfirm = () => {
    if (currentStep === EditStep.EditCredentials)
      handleVerifyCredentials()
    else
      handleUpdate()
  }

  const basicFormSchemas: FormSchema[] = useMemo(() => [
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
  ], [t, subscription.name, subscription.endpoint])

  const credentialsFormSchemas: FormSchema[] = useMemo(() => {
    return apiKeyCredentialsSchema.map(schema => ({
      ...schema,
      type: normalizeFormType(schema.type as string),
      tooltip: schema.help,
      default: subscription.credentials?.[schema.name] || schema.default,
    }))
  }, [apiKeyCredentialsSchema, subscription.credentials])

  const parametersFormSchemas: FormSchema[] = useMemo(() => {
    return parametersSchema.map((schema: ParametersSchema) => {
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
              credentials: verifiedCredentials || undefined,
            }
          : undefined,
        fieldClassName: schema.type === FormTypeEnum.boolean ? 'flex items-center justify-between' : undefined,
        labelClassName: schema.type === FormTypeEnum.boolean ? 'mb-0' : undefined,
      }
    })
  }, [parametersSchema, subscription.parameters, subscription.id, detail?.plugin_id, detail?.provider, verifiedCredentials])

  const getConfirmButtonText = () => {
    if (currentStep === EditStep.EditCredentials)
      return isVerifying ? t('modal.common.verifying', { ns: 'pluginTrigger' }) : t('modal.common.verify', { ns: 'pluginTrigger' })

    return isUpdating ? t('operation.saving', { ns: 'common' }) : t('operation.save', { ns: 'common' })
  }

  const handleBack = () => {
    setCurrentStep(EditStep.EditCredentials)
    setVerifiedCredentials(null)
  }

  return (
    <Modal
      title={t('subscription.list.item.actions.edit.title', { ns: 'pluginTrigger' })}
      confirmButtonText={getConfirmButtonText()}
      onClose={onClose}
      onCancel={onClose}
      onConfirm={handleConfirm}
      disabled={isUpdating || isVerifying}
      showExtraButton={currentStep === EditStep.EditConfiguration}
      extraButtonText={t('modal.common.back', { ns: 'pluginTrigger' })}
      extraButtonVariant="secondary"
      onExtraButtonClick={handleBack}
      clickOutsideNotClose
      wrapperClassName="!z-[101]"
      bottomSlot={currentStep === EditStep.EditCredentials ? <EncryptedBottom /> : null}
    >
      {pluginDetail && (
        <ReadmeEntrance pluginDetail={pluginDetail} showType={ReadmeShowType.modal} />
      )}

      {/* Multi-step indicator */}
      <MultiSteps currentStep={currentStep} onStepClick={handleBack} />

      {/* Step 1: Edit Credentials */}
      {currentStep === EditStep.EditCredentials && (
        <div className="mb-4">
          {credentialsFormSchemas.length > 0 && (
            <BaseForm
              formSchemas={credentialsFormSchemas}
              ref={credentialsFormRef}
              labelClassName="system-sm-medium mb-2 flex items-center gap-1 text-text-primary"
              formClassName="space-y-4"
              preventDefaultSubmit={true}
            />
          )}
        </div>
      )}

      {/* Step 2: Edit Configuration */}
      {currentStep === EditStep.EditConfiguration && (
        <div className="max-h-[70vh]">
          {/* Basic form: subscription name and callback URL */}
          <BaseForm
            formSchemas={basicFormSchemas}
            ref={basicFormRef}
            labelClassName="system-sm-medium mb-2 flex items-center gap-1 text-text-primary"
            formClassName="space-y-4 mb-4"
          />

          {/* Parameters */}
          {parametersFormSchemas.length > 0 && (
            <BaseForm
              formSchemas={parametersFormSchemas}
              ref={parametersFormRef}
              labelClassName="system-sm-medium mb-2 flex items-center gap-1 text-text-primary"
              formClassName="space-y-4"
            />
          )}
        </div>
      )}
    </Modal>
  )
}
