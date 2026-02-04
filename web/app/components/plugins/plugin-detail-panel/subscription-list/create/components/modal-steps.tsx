'use client'
import type { FormRefObject, FormSchema } from '@/app/components/base/form/types'
import type { TriggerLogEntity, TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import { RiLoader2Line } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { BaseForm } from '@/app/components/base/form/components/base'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import LogViewer from '../../log-viewer'
import { ApiKeyStep } from '../hooks/use-common-modal-state'

export type SchemaItem = Partial<FormSchema> & Record<string, unknown> & {
  name: string
}

type StatusStepProps = {
  isActive: boolean
  text: string
}

export const StatusStep = ({ isActive, text }: StatusStepProps) => {
  return (
    <div className={`system-2xs-semibold-uppercase flex items-center gap-1 ${isActive
      ? 'text-state-accent-solid'
      : 'text-text-tertiary'}`}
    >
      {isActive && (
        <div className="h-1 w-1 rounded-full bg-state-accent-solid"></div>
      )}
      {text}
    </div>
  )
}

type MultiStepsProps = {
  currentStep: ApiKeyStep
}

export const MultiSteps = ({ currentStep }: MultiStepsProps) => {
  const { t } = useTranslation()
  return (
    <div className="mb-6 flex w-1/3 items-center gap-2">
      <StatusStep isActive={currentStep === ApiKeyStep.Verify} text={t('modal.steps.verify', { ns: 'pluginTrigger' })} />
      <div className="h-px w-3 shrink-0 bg-divider-deep"></div>
      <StatusStep isActive={currentStep === ApiKeyStep.Configuration} text={t('modal.steps.configuration', { ns: 'pluginTrigger' })} />
    </div>
  )
}

type VerifyStepContentProps = {
  apiKeyCredentialsSchema: SchemaItem[]
  apiKeyCredentialsFormRef: React.RefObject<FormRefObject | null>
  onChange: () => void
}

export const VerifyStepContent = ({
  apiKeyCredentialsSchema,
  apiKeyCredentialsFormRef,
  onChange,
}: VerifyStepContentProps) => {
  if (!apiKeyCredentialsSchema.length)
    return null

  return (
    <div className="mb-4">
      <BaseForm
        formSchemas={apiKeyCredentialsSchema as FormSchema[]}
        ref={apiKeyCredentialsFormRef}
        labelClassName="system-sm-medium mb-2 flex items-center gap-1 text-text-primary"
        preventDefaultSubmit={true}
        formClassName="space-y-4"
        onChange={onChange}
      />
    </div>
  )
}

type SubscriptionFormProps = {
  subscriptionFormRef: React.RefObject<FormRefObject | null>
  endpoint?: string
}

export const SubscriptionForm = ({
  subscriptionFormRef,
  endpoint,
}: SubscriptionFormProps) => {
  const { t } = useTranslation()

  const formSchemas = React.useMemo(() => [
    {
      name: 'subscription_name',
      label: t('modal.form.subscriptionName.label', { ns: 'pluginTrigger' }),
      placeholder: t('modal.form.subscriptionName.placeholder', { ns: 'pluginTrigger' }),
      type: FormTypeEnum.textInput,
      required: true,
    },
    {
      name: 'callback_url',
      label: t('modal.form.callbackUrl.label', { ns: 'pluginTrigger' }),
      placeholder: t('modal.form.callbackUrl.placeholder', { ns: 'pluginTrigger' }),
      type: FormTypeEnum.textInput,
      required: false,
      default: endpoint || '',
      disabled: true,
      tooltip: t('modal.form.callbackUrl.tooltip', { ns: 'pluginTrigger' }),
      showCopy: true,
    },
  ], [endpoint, t])

  return (
    <BaseForm
      formSchemas={formSchemas}
      ref={subscriptionFormRef}
      labelClassName="system-sm-medium mb-2 flex items-center gap-1 text-text-primary"
      formClassName="space-y-4 mb-4"
    />
  )
}

const normalizeFormType = (type: FormTypeEnum | string): FormTypeEnum => {
  if (Object.values(FormTypeEnum).includes(type as FormTypeEnum))
    return type as FormTypeEnum

  const TYPE_MAP: Record<string, FormTypeEnum> = {
    string: FormTypeEnum.textInput,
    text: FormTypeEnum.textInput,
    password: FormTypeEnum.secretInput,
    secret: FormTypeEnum.secretInput,
    number: FormTypeEnum.textNumber,
    integer: FormTypeEnum.textNumber,
    boolean: FormTypeEnum.boolean,
  }

  return TYPE_MAP[type] || FormTypeEnum.textInput
}

type AutoParametersFormProps = {
  schemas: SchemaItem[]
  formRef: React.RefObject<FormRefObject | null>
  pluginId: string
  provider: string
  credentialId: string
}

export const AutoParametersForm = ({
  schemas,
  formRef,
  pluginId,
  provider,
  credentialId,
}: AutoParametersFormProps) => {
  const formSchemas = React.useMemo(() =>
    schemas.map((schema) => {
      const normalizedType = normalizeFormType((schema.type || FormTypeEnum.textInput) as FormTypeEnum | string)
      return {
        ...schema,
        tooltip: schema.description,
        type: normalizedType,
        dynamicSelectParams: normalizedType === FormTypeEnum.dynamicSelect
          ? {
              plugin_id: pluginId,
              provider,
              action: 'provider',
              parameter: schema.name,
              credential_id: credentialId,
            }
          : undefined,
        fieldClassName: normalizedType === FormTypeEnum.boolean ? 'flex items-center justify-between' : undefined,
        labelClassName: normalizedType === FormTypeEnum.boolean ? 'mb-0' : undefined,
      }
    }) as FormSchema[], [schemas, pluginId, provider, credentialId])

  if (!schemas.length)
    return null

  return (
    <BaseForm
      formSchemas={formSchemas}
      ref={formRef}
      labelClassName="system-sm-medium mb-2 flex items-center gap-1 text-text-primary"
      formClassName="space-y-4"
    />
  )
}

type ManualPropertiesSectionProps = {
  schemas: SchemaItem[]
  formRef: React.RefObject<FormRefObject | null>
  onChange: () => void
  logs: TriggerLogEntity[]
  pluginName: string
}

export const ManualPropertiesSection = ({
  schemas,
  formRef,
  onChange,
  logs,
  pluginName,
}: ManualPropertiesSectionProps) => {
  const { t } = useTranslation()

  const formSchemas = React.useMemo(() =>
    schemas.map(schema => ({
      ...schema,
      tooltip: schema.description,
    })) as FormSchema[], [schemas])

  return (
    <>
      {schemas.length > 0 && (
        <div className="mb-6">
          <BaseForm
            formSchemas={formSchemas}
            ref={formRef}
            labelClassName="system-sm-medium mb-2 flex items-center gap-1 text-text-primary"
            formClassName="space-y-4"
            onChange={onChange}
          />
        </div>
      )}
      <div className="mb-6">
        <div className="mb-3 flex items-center gap-2">
          <div className="system-xs-medium-uppercase text-text-tertiary">
            {t('modal.manual.logs.title', { ns: 'pluginTrigger' })}
          </div>
          <div className="h-px flex-1 bg-gradient-to-r from-divider-regular to-transparent" />
        </div>

        <div className="mb-1 flex items-center justify-center gap-1 rounded-lg bg-background-section p-3">
          <div className="h-3.5 w-3.5">
            <RiLoader2Line className="h-full w-full animate-spin" />
          </div>
          <div className="system-xs-regular text-text-tertiary">
            {t('modal.manual.logs.loading', { ns: 'pluginTrigger', pluginName })}
          </div>
        </div>
        <LogViewer logs={logs} />
      </div>
    </>
  )
}

type ConfigurationStepContentProps = {
  createType: SupportedCreationMethods
  subscriptionBuilder?: TriggerSubscriptionBuilder
  subscriptionFormRef: React.RefObject<FormRefObject | null>
  autoCommonParametersSchema: SchemaItem[]
  autoCommonParametersFormRef: React.RefObject<FormRefObject | null>
  manualPropertiesSchema: SchemaItem[]
  manualPropertiesFormRef: React.RefObject<FormRefObject | null>
  onManualPropertiesChange: () => void
  logs: TriggerLogEntity[]
  pluginId: string
  pluginName: string
  provider: string
}

export const ConfigurationStepContent = ({
  createType,
  subscriptionBuilder,
  subscriptionFormRef,
  autoCommonParametersSchema,
  autoCommonParametersFormRef,
  manualPropertiesSchema,
  manualPropertiesFormRef,
  onManualPropertiesChange,
  logs,
  pluginId,
  pluginName,
  provider,
}: ConfigurationStepContentProps) => {
  const isManualType = createType === SupportedCreationMethods.MANUAL

  return (
    <div className="max-h-[70vh]">
      <SubscriptionForm
        subscriptionFormRef={subscriptionFormRef}
        endpoint={subscriptionBuilder?.endpoint}
      />

      {!isManualType && autoCommonParametersSchema.length > 0 && (
        <AutoParametersForm
          schemas={autoCommonParametersSchema}
          formRef={autoCommonParametersFormRef}
          pluginId={pluginId}
          provider={provider}
          credentialId={subscriptionBuilder?.id || ''}
        />
      )}

      {isManualType && (
        <ManualPropertiesSection
          schemas={manualPropertiesSchema}
          formRef={manualPropertiesFormRef}
          onChange={onManualPropertiesChange}
          logs={logs}
          pluginName={pluginName}
        />
      )}
    </div>
  )
}
