'use client'
import { CopyFeedbackNew } from '@/app/components/base/copy-feedback'
import { BaseForm } from '@/app/components/base/form/components/base'
import type { FormRefObject } from '@/app/components/base/form/types'
import { FormTypeEnum } from '@/app/components/base/form/types'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal/modal'
import Toast from '@/app/components/base/toast'
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import type { TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import { TriggerCredentialTypeEnum } from '@/app/components/workflow/block-selector/types'
import {
  useBuildTriggerSubscription,
  useCreateTriggerSubscriptionBuilder,
  useTriggerSubscriptionBuilderLogs,
  useVerifyTriggerSubscriptionBuilder,
} from '@/service/use-triggers'
import { RiLoader2Line } from '@remixicon/react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePluginStore, usePluginSubscriptionStore } from '../../store'
import LogViewer from '../log-viewer'

type Props = {
  onClose: () => void
  createType: SupportedCreationMethods
  builder?: TriggerSubscriptionBuilder
}

const CREDENTIAL_TYPE_MAP: Record<SupportedCreationMethods, TriggerCredentialTypeEnum> = {
  [SupportedCreationMethods.APIKEY]: TriggerCredentialTypeEnum.ApiKey,
  [SupportedCreationMethods.OAUTH]: TriggerCredentialTypeEnum.Oauth2,
  [SupportedCreationMethods.MANUAL]: TriggerCredentialTypeEnum.Unauthorized,
}

enum ApiKeyStep {
  Verify = 'verify',
  Configuration = 'configuration',
}

const StatusStep = ({ isActive, text }: { isActive: boolean, text: string }) => {
  return <div className={`system-2xs-semibold-uppercase flex items-center gap-1 ${isActive
    ? 'text-state-accent-solid'
    : 'text-text-tertiary'}`}>
    {/* Active indicator dot */}
    {isActive && (
      <div className='h-1 w-1 rounded-full bg-state-accent-solid'></div>
    )}
    {text}
  </div>
}

const MultiSteps = ({ currentStep }: { currentStep: ApiKeyStep }) => {
  const { t } = useTranslation()
  return <div className='mb-6 flex w-1/3 items-center gap-2'>
    <StatusStep isActive={currentStep === ApiKeyStep.Verify} text={t('pluginTrigger.modal.steps.verify')} />
    <div className='h-px w-3 shrink-0 bg-divider-deep'></div>
    <StatusStep isActive={currentStep === ApiKeyStep.Configuration} text={t('pluginTrigger.modal.steps.configuration')} />
  </div>
}

export const CommonCreateModal = ({ onClose, createType, builder }: Props) => {
  const { t } = useTranslation()
  const detail = usePluginStore(state => state.detail)
  const { refresh } = usePluginSubscriptionStore()

  const [currentStep, setCurrentStep] = useState<ApiKeyStep>(createType === SupportedCreationMethods.APIKEY ? ApiKeyStep.Verify : ApiKeyStep.Configuration)

  const [subscriptionName, setSubscriptionName] = useState('')
  const [subscriptionBuilder, setSubscriptionBuilder] = useState<TriggerSubscriptionBuilder | undefined>(builder)
  const [verificationError, setVerificationError] = useState<string>('')

  const { mutate: verifyCredentials, isPending: isVerifyingCredentials } = useVerifyTriggerSubscriptionBuilder()
  const { mutate: createBuilder /* isPending: isCreatingBuilder */ } = useCreateTriggerSubscriptionBuilder()
  const { mutate: buildSubscription, isPending: isBuilding } = useBuildTriggerSubscription()

  const providerName = `${detail?.plugin_id}/${detail?.declaration.name}`
  const propertiesSchema = detail?.declaration.trigger.subscription_schema.properties_schema || [] // manual
  const propertiesFormRef = React.useRef<FormRefObject>(null)
  const parametersSchema = detail?.declaration.trigger?.subscription_schema?.parameters_schema || [] // apikey and oauth
  const parametersFormRef = React.useRef<FormRefObject>(null)
  const credentialsSchema = detail?.declaration.trigger?.credentials_schema || []
  const credentialsFormRef = React.useRef<FormRefObject>(null)

  const { data: logData } = useTriggerSubscriptionBuilderLogs(
    providerName,
    subscriptionBuilder?.id || '',
    {
      enabled: createType === SupportedCreationMethods.MANUAL && !!subscriptionBuilder?.id,
      refetchInterval: 3000,
    },
  )

  useEffect(() => {
    if (!subscriptionBuilder) {
      createBuilder(
        {
          provider: providerName,
          credential_type: CREDENTIAL_TYPE_MAP[createType],
        },
        {
          onSuccess: (response) => {
            const builder = response.subscription_builder
            setSubscriptionBuilder(builder)
          },
          onError: (error) => {
            Toast.notify({
              type: 'error',
              message: t('pluginTrigger.modal.errors.createFailed'),
            })
            console.error('Failed to create subscription builder:', error)
          },
        },
      )
    }
  }, [createBuilder, providerName, subscriptionBuilder, t])

  const handleVerify = () => {
    const credentialsFormValues = credentialsFormRef.current?.getFormValues({}) || { values: {}, isCheckValidated: false }
    const credentials = credentialsFormValues.values

    if (!Object.keys(credentials).length) {
      Toast.notify({
        type: 'error',
        message: 'Please fill in all required credentials',
      })
      return
    }

    setVerificationError('')

    verifyCredentials(
      {
        provider: providerName,
        subscriptionBuilderId: subscriptionBuilder?.id || '',
        credentials,
      },
      {
        onSuccess: () => {
          Toast.notify({
            type: 'success',
            message: t('pluginTrigger.modal.apiKey.verify.success'),
          })
          setCurrentStep(ApiKeyStep.Configuration)
        },
        onError: (error: any) => {
          setVerificationError(error?.message || t('pluginTrigger.modal.apiKey.verify.error'))
        },
      },
    )
  }

  const handleCreate = () => {
    if (!subscriptionName.trim()) {
      Toast.notify({
        type: 'error',
        message: t('pluginTrigger.modal.form.subscriptionName.required'),
      })
      return
    }

    if (!subscriptionBuilder)
      return

    const parameterForm = parametersFormRef.current?.getFormValues({}) || { values: {}, isCheckValidated: false }
    // console.log('formValues', formValues)
    // if (!formValues.isCheckValidated) {
    //   Toast.notify({
    //     type: 'error',
    //     message: t('pluginTrigger.modal.form.properties.required'),
    //   })
    //   return
    // }

    buildSubscription(
      {
        provider: providerName,
        subscriptionBuilderId: subscriptionBuilder.id,
        name: subscriptionName,
        parameters: { ...parameterForm.values, events: ['*'] },
        // properties: formValues.values,
      },
      {
        onSuccess: () => {
          Toast.notify({
            type: 'success',
            message: 'Subscription created successfully',
          })
          onClose()
          refresh?.()
        },
        onError: (error: any) => {
          Toast.notify({
            type: 'error',
            message: error?.message || t('pluginTrigger.modal.errors.createFailed'),
          })
        },
      },
    )
  }

  const handleConfirm = () => {
    if (currentStep === ApiKeyStep.Verify)
      handleVerify()
    else
      handleCreate()
  }

  return (
    <Modal
      title={t(`pluginTrigger.modal.${createType === SupportedCreationMethods.APIKEY ? 'apiKey' : createType.toLowerCase()}.title`)}
      confirmButtonText={
        currentStep === ApiKeyStep.Verify
          ? isVerifyingCredentials ? t('pluginTrigger.modal.common.verifying') : t('pluginTrigger.modal.common.verify')
          : isBuilding ? t('pluginTrigger.modal.common.creating') : t('pluginTrigger.modal.common.create')
      }
      onClose={onClose}
      onCancel={onClose}
      onConfirm={handleConfirm}
    >
      {createType === SupportedCreationMethods.APIKEY && <MultiSteps currentStep={currentStep} />}
      {currentStep === ApiKeyStep.Verify && (
        <>
          {credentialsSchema.length > 0 && (
            <div className='mb-4'>
              <BaseForm
                formSchemas={credentialsSchema}
                ref={credentialsFormRef}
                labelClassName='system-sm-medium mb-2 block text-text-primary'
                preventDefaultSubmit={true}
              />
            </div>
          )}
          {verificationError && (
            <div className='bg-state-destructive-bg mb-4 rounded-lg border border-state-destructive-border p-3'>
              <div className='text-state-destructive-text system-xs-medium'>
                {verificationError}
              </div>
            </div>
          )}
        </>
      )}
      {currentStep === ApiKeyStep.Configuration && <div className='max-h-[70vh] overflow-y-auto'>
        <div className='mb-6'>
          <label className='system-sm-medium mb-2 block text-text-primary'>
            {t('pluginTrigger.modal.form.subscriptionName.label')}
          </label>
          <Input
            value={subscriptionName}
            onChange={e => setSubscriptionName(e.target.value)}
            placeholder={t('pluginTrigger.modal.form.subscriptionName.placeholder')}
          />
        </div>

        <div className='mb-6'>
          <label className='system-sm-medium mb-2 block text-text-primary'>
            {t('pluginTrigger.modal.form.callbackUrl.label')}
          </label>
          <div className='relative'>
            <Input
              value={subscriptionBuilder?.endpoint}
              readOnly
              className='pr-12'
              placeholder={t('pluginTrigger.modal.form.callbackUrl.placeholder')}
            />
            <CopyFeedbackNew className='absolute right-1 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary' content={subscriptionBuilder?.endpoint || ''} />
          </div>
          <div className='system-xs-regular mt-1 text-text-tertiary'>
            {t('pluginTrigger.modal.form.callbackUrl.description')}
          </div>
        </div>
        {createType !== SupportedCreationMethods.MANUAL && parametersSchema.length > 0 && (
          <BaseForm
            formSchemas={parametersSchema.map(schema => ({
              ...schema,
              dynamicSelectParams: schema.type === FormTypeEnum.dynamicSelect ? {
                plugin_id: detail?.plugin_id || '',
                provider: providerName,
                action: 'provider',
                parameter: schema.name,
                credential_id: subscriptionBuilder?.id || '',
              } : undefined,
            }))}
            ref={parametersFormRef}
            labelClassName='system-sm-medium mb-2 block text-text-primary'
          />
        )}
        {createType === SupportedCreationMethods.MANUAL && <>
          {propertiesSchema.length > 0 && (
            <div className='mb-6'>
              <BaseForm
                formSchemas={propertiesSchema}
                ref={propertiesFormRef}
                labelClassName='system-sm-medium mb-2 block text-text-primary'
              />
            </div>
          )}
          <div className='mb-6'>
            <div className='mb-3 flex items-center gap-2'>
              <div className='system-xs-medium-uppercase text-text-tertiary'>
                REQUESTS HISTORY
              </div>
              <div className='h-px flex-1 bg-gradient-to-r from-divider-regular to-transparent' />
            </div>

            <div className='mb-1 flex items-center justify-center gap-1 rounded-lg bg-background-section p-3'>
              <div className='h-3.5 w-3.5'>
                <RiLoader2Line className='h-full w-full animate-spin' />
              </div>
              <div className='system-xs-regular text-text-tertiary'>
                Awaiting request from {detail?.declaration.name}...
              </div>
            </div>

            <LogViewer logs={logData?.logs || []} />
          </div>
        </>}

      </div>}
    </Modal>
  )
}
