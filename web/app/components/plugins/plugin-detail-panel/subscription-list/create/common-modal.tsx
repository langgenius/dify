'use client'
// import { CopyFeedbackNew } from '@/app/components/base/copy-feedback'
import { EncryptedBottom } from '@/app/components/base/encrypted-bottom'
import { BaseForm } from '@/app/components/base/form/components/base'
import type { FormRefObject } from '@/app/components/base/form/types'
import { FormTypeEnum } from '@/app/components/base/form/types'
import Modal from '@/app/components/base/modal/modal'
import Toast from '@/app/components/base/toast'
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import type { TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import { TriggerCredentialTypeEnum } from '@/app/components/workflow/block-selector/types'
import {
  useBuildTriggerSubscription,
  useCreateTriggerSubscriptionBuilder,
  useTriggerSubscriptionBuilderLogs,
  useUpdateTriggerSubscriptionBuilder,
  useVerifyTriggerSubscriptionBuilder,
} from '@/service/use-triggers'
import { parsePluginErrorMessage } from '@/utils/error-parser'
import { RiLoader2Line } from '@remixicon/react'
import { debounce } from 'lodash-es'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import LogViewer from '../log-viewer'
import { usePluginStore, usePluginSubscriptionStore } from '../store'

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

  const [subscriptionBuilder, setSubscriptionBuilder] = useState<TriggerSubscriptionBuilder | undefined>(builder)
  const isInitializedRef = useRef(false)

  const { mutate: verifyCredentials, isPending: isVerifyingCredentials } = useVerifyTriggerSubscriptionBuilder()
  const { mutateAsync: createBuilder /* isPending: isCreatingBuilder */ } = useCreateTriggerSubscriptionBuilder()
  const { mutate: buildSubscription, isPending: isBuilding } = useBuildTriggerSubscription()
  const { mutate: updateBuilder } = useUpdateTriggerSubscriptionBuilder()

  const manualPropertiesSchema = detail?.declaration.trigger.subscription_schema || [] // manual
  const manualPropertiesFormRef = React.useRef<FormRefObject>(null)

  const subscriptionFormRef = React.useRef<FormRefObject>(null)

  const autoCommonParametersSchema = detail?.declaration.trigger?.subscription_constructor?.parameters || [] // apikey and oauth
  const autoCommonParametersFormRef = React.useRef<FormRefObject>(null)

  const apiKeyCredentialsSchema = detail?.declaration.trigger?.subscription_constructor?.credentials_schema || []
  const apiKeyCredentialsFormRef = React.useRef<FormRefObject>(null)

  const { data: logData } = useTriggerSubscriptionBuilderLogs(
    detail?.provider || '',
    subscriptionBuilder?.id || '',
    {
      enabled: createType === SupportedCreationMethods.MANUAL,
      refetchInterval: 3000,
    },
  )

  useEffect(() => {
    const initializeBuilder = async () => {
      isInitializedRef.current = true
      try {
        const response = await createBuilder({
          provider: detail?.provider || '',
          credential_type: CREDENTIAL_TYPE_MAP[createType],
        })
        setSubscriptionBuilder(response.subscription_builder)
      }
      catch (error) {
        console.error('createBuilder error:', error)
        Toast.notify({
          type: 'error',
          message: t('pluginTrigger.modal.errors.createFailed'),
        })
      }
    }
    if (!isInitializedRef.current && !subscriptionBuilder && detail?.provider)
      initializeBuilder()
  }, [subscriptionBuilder, detail?.provider, createType, createBuilder, t])

  useEffect(() => {
    if (subscriptionBuilder?.endpoint && subscriptionFormRef.current) {
      const form = subscriptionFormRef.current.getForm()
      if (form)
        form.setFieldValue('callback_url', subscriptionBuilder.endpoint)
    }
  }, [subscriptionBuilder?.endpoint])

  const debouncedUpdate = useMemo(
    () => debounce((provider: string, builderId: string, properties: Record<string, any>) => {
      updateBuilder(
        {
          provider,
          subscriptionBuilderId: builderId,
          properties,
        },
        {
          onError: (error: any) => {
            console.error('Failed to update subscription builder:', error)
            Toast.notify({
              type: 'error',
              message: error?.message || t('pluginTrigger.modal.errors.updateFailed'),
            })
          },
        },
      )
    }, 500),
    [updateBuilder, t],
  )

  const handleManualPropertiesChange = useCallback(() => {
    if (!subscriptionBuilder || !detail?.provider)
      return

    const formValues = manualPropertiesFormRef.current?.getFormValues({}) || { values: {}, isCheckValidated: false }

    debouncedUpdate(detail.provider, subscriptionBuilder.id, formValues.values)
  }, [subscriptionBuilder, detail?.provider, debouncedUpdate])

  useEffect(() => {
    return () => {
      debouncedUpdate.cancel()
    }
  }, [debouncedUpdate])

  const handleVerify = () => {
    const apiKeyCredentialsFormValues = apiKeyCredentialsFormRef.current?.getFormValues({}) || { values: {}, isCheckValidated: false }
    const credentials = apiKeyCredentialsFormValues.values

    if (!Object.keys(credentials).length) {
      Toast.notify({
        type: 'error',
        message: 'Please fill in all required credentials',
      })
      return
    }

    apiKeyCredentialsFormRef.current?.setFields([{
      name: Object.keys(credentials)[0],
      errors: [],
    }])

    verifyCredentials(
      {
        provider: detail?.provider || '',
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
        onError: async (error: any) => {
          const errorMessage = await parsePluginErrorMessage(error) || t('pluginTrigger.modal.apiKey.verify.error')
          apiKeyCredentialsFormRef.current?.setFields([{
            name: Object.keys(credentials)[0],
            errors: [errorMessage],
          }])
        },
      },
    )
  }

  const handleCreate = () => {
    const autoCommonParametersFormValues = autoCommonParametersFormRef.current?.getFormValues({}) || { values: {}, isCheckValidated: false }
    const subscriptionFormValues = subscriptionFormRef.current?.getFormValues({}) || { values: {}, isCheckValidated: false }
    // console.log('parameterForm', parameterForm)

    if (!subscriptionFormValues?.isCheckValidated || (createType !== SupportedCreationMethods.MANUAL && !autoCommonParametersFormValues?.isCheckValidated)) {
      // Toast.notify({
      //   type: 'error',
      //   message: 'Please fill in all required fields',
      // })
      return
    }

    if (!subscriptionBuilder) {
      Toast.notify({
        type: 'error',
        message: 'Subscription builder not found',
      })
      return
    }

    const subscriptionNameValue = subscriptionFormValues?.values.subscription_name as string

    buildSubscription(
      {
        provider: detail?.provider || '',
        subscriptionBuilderId: subscriptionBuilder.id,
        name: subscriptionNameValue,
        parameters: autoCommonParametersFormValues.values,
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
        onError: async (error: any) => {
          const errorMessage = await parsePluginErrorMessage(error) || t('pluginTrigger.modal.errors.createFailed')
          Toast.notify({
            type: 'error',
            message: errorMessage,
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

  const handleApiKeyCredentialsChange = () => {
    apiKeyCredentialsFormRef.current?.setFields([{
      name: apiKeyCredentialsSchema[0].name,
      errors: [],
    }])
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
      disabled={isVerifyingCredentials || isBuilding}
      bottomSlot={currentStep === ApiKeyStep.Verify ? <EncryptedBottom /> : null}
    >
      {createType === SupportedCreationMethods.APIKEY && <MultiSteps currentStep={currentStep} />}
      {currentStep === ApiKeyStep.Verify && (
        <>
          {apiKeyCredentialsSchema.length > 0 && (
            <div className='mb-4'>
              <BaseForm
                formSchemas={apiKeyCredentialsSchema}
                ref={apiKeyCredentialsFormRef}
                labelClassName='system-sm-medium mb-2 block text-text-primary'
                preventDefaultSubmit={true}
                formClassName='space-y-4'
                onChange={handleApiKeyCredentialsChange}
              />
            </div>
          )}
        </>
      )}
      {currentStep === ApiKeyStep.Configuration && <div className='max-h-[70vh] overflow-y-auto'>
        <BaseForm
          formSchemas={[
            {
              name: 'subscription_name',
              label: t('pluginTrigger.modal.form.subscriptionName.label'),
              placeholder: t('pluginTrigger.modal.form.subscriptionName.placeholder'),
              type: FormTypeEnum.textInput,
              required: true,
            },
            {
              name: 'callback_url',
              label: t('pluginTrigger.modal.form.callbackUrl.label'),
              placeholder: t('pluginTrigger.modal.form.callbackUrl.placeholder'),
              type: FormTypeEnum.textInput,
              required: false,
              default: subscriptionBuilder?.endpoint || '',
              disabled: true,
              tooltip: t('pluginTrigger.modal.form.callbackUrl.tooltip'),
              // extra: subscriptionBuilder?.endpoint ? (
              //   <CopyFeedbackNew
              //     className='absolute right-1 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary'
              //     content={subscriptionBuilder?.endpoint || ''}
              //   />
              // ) : undefined,
            },
          ]}
          ref={subscriptionFormRef}
          labelClassName='system-sm-medium mb-2 flex items-center gap-1 text-text-primary'
          formClassName='space-y-4 mb-4'
        />
        {/* <div className='system-xs-regular mb-6 mt-[-1rem] text-text-tertiary'>
          {t('pluginTrigger.modal.form.callbackUrl.description')}
        </div> */}
        {createType !== SupportedCreationMethods.MANUAL && autoCommonParametersSchema.length > 0 && (
          <BaseForm
            formSchemas={autoCommonParametersSchema.map(schema => ({
              ...schema,
              dynamicSelectParams: schema.type === FormTypeEnum.dynamicSelect ? {
                plugin_id: detail?.plugin_id || '',
                provider: detail?.provider || '',
                action: 'provider',
                parameter: schema.name,
                credential_id: subscriptionBuilder?.id || '',
              } : undefined,
            }))}
            ref={autoCommonParametersFormRef}
            labelClassName='system-sm-medium mb-2 block text-text-primary'
            formClassName='space-y-4'
          />
        )}
        {createType === SupportedCreationMethods.MANUAL && <>
          {manualPropertiesSchema.length > 0 && (
            <div className='mb-6'>
              <BaseForm
                formSchemas={manualPropertiesSchema}
                ref={manualPropertiesFormRef}
                labelClassName='system-sm-medium mb-2 block text-text-primary'
                formClassName='space-y-4'
                onChange={handleManualPropertiesChange}
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
                Awaiting request from {detail?.plugin_id}...
              </div>
            </div>
            <LogViewer logs={logData?.logs || []} />
          </div>
        </>}
      </div>}
    </Modal>
  )
}
