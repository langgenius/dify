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
import type { BuildTriggerSubscriptionPayload } from '@/service/use-triggers'
import {
  useBuildTriggerSubscription,
  useCreateTriggerSubscriptionBuilder,
  useTriggerSubscriptionBuilderLogs,
  useUpdateTriggerSubscriptionBuilder,
  useVerifyTriggerSubscriptionBuilder,
} from '@/service/use-triggers'
import { parsePluginErrorMessage } from '@/utils/error-parser'
import { isPrivateOrLocalAddress } from '@/utils/urlValidation'
import { RiLoader2Line } from '@remixicon/react'
import { debounce } from 'lodash-es'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import LogViewer from '../log-viewer'
import { usePluginSubscriptionStore } from '../store'
import { usePluginStore } from '../../store'

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

const defaultFormValues = { values: {}, isCheckValidated: false }

const normalizeFormType = (type: FormTypeEnum | string): FormTypeEnum => {
  if (Object.values(FormTypeEnum).includes(type as FormTypeEnum))
    return type as FormTypeEnum

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
    default:
      return FormTypeEnum.textInput
  }
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

  const manualPropertiesSchema = detail?.declaration?.trigger?.subscription_schema || [] // manual
  const manualPropertiesFormRef = React.useRef<FormRefObject>(null)

  const subscriptionFormRef = React.useRef<FormRefObject>(null)

  const autoCommonParametersSchema = detail?.declaration.trigger?.subscription_constructor?.parameters || [] // apikey and oauth
  const autoCommonParametersFormRef = React.useRef<FormRefObject>(null)

  const rawApiKeyCredentialsSchema = detail?.declaration.trigger?.subscription_constructor?.credentials_schema || []
  const apiKeyCredentialsSchema = useMemo(() => {
    return rawApiKeyCredentialsSchema.map(schema => ({
      ...schema,
      tooltip: schema.help,
    }))
  }, [rawApiKeyCredentialsSchema])
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
    if (subscriptionBuilder?.endpoint && subscriptionFormRef.current && currentStep === ApiKeyStep.Configuration) {
      const form = subscriptionFormRef.current.getForm()
      if (form)
        form.setFieldValue('callback_url', subscriptionBuilder.endpoint)
      if (isPrivateOrLocalAddress(subscriptionBuilder.endpoint)) {
        console.log('isPrivateOrLocalAddress', isPrivateOrLocalAddress(subscriptionBuilder.endpoint))
        subscriptionFormRef.current?.setFields([{
          name: 'callback_url',
          warnings: [t('pluginTrigger.modal.form.callbackUrl.privateAddressWarning')],
        }])
      }
      else {
        subscriptionFormRef.current?.setFields([{
          name: 'callback_url',
          warnings: [],
        }])
      }
    }
  }, [subscriptionBuilder?.endpoint, currentStep, t])

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

    const formValues = manualPropertiesFormRef.current?.getFormValues({ needCheckValidatedValues: false }) || { values: {}, isCheckValidated: true }

    debouncedUpdate(detail.provider, subscriptionBuilder.id, formValues.values)
  }, [subscriptionBuilder, detail?.provider, debouncedUpdate])

  useEffect(() => {
    return () => {
      debouncedUpdate.cancel()
    }
  }, [debouncedUpdate])

  const handleVerify = () => {
    const apiKeyCredentialsFormValues = apiKeyCredentialsFormRef.current?.getFormValues({}) || defaultFormValues
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
    if (!subscriptionBuilder) {
      Toast.notify({
        type: 'error',
        message: 'Subscription builder not found',
      })
      return
    }

    const subscriptionFormValues = subscriptionFormRef.current?.getFormValues({})
    if (!subscriptionFormValues?.isCheckValidated)
      return

    const subscriptionNameValue = subscriptionFormValues?.values?.subscription_name as string

    const params: BuildTriggerSubscriptionPayload = {
      provider: detail?.provider || '',
      subscriptionBuilderId: subscriptionBuilder.id,
      name: subscriptionNameValue,
    }

    if (createType !== SupportedCreationMethods.MANUAL) {
      if (autoCommonParametersSchema.length > 0) {
        const autoCommonParametersFormValues = autoCommonParametersFormRef.current?.getFormValues({}) || defaultFormValues
        if (!autoCommonParametersFormValues?.isCheckValidated)
          return
        params.parameters = autoCommonParametersFormValues.values
      }
    }
    else if (manualPropertiesSchema.length > 0) {
      const manualFormValues = manualPropertiesFormRef.current?.getFormValues({}) || defaultFormValues
      if (!manualFormValues?.isCheckValidated)
        return
    }

    buildSubscription(
      params,
      {
        onSuccess: () => {
          Toast.notify({
            type: 'success',
            message: t('pluginTrigger.subscription.createSuccess'),
          })
          onClose()
          refresh?.()
        },
        onError: async (error: any) => {
          const errorMessage = await parsePluginErrorMessage(error) || t('pluginTrigger.subscription.createFailed')
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
      size={createType === SupportedCreationMethods.MANUAL ? 'md' : 'sm'}
      containerClassName='min-h-[360px]'
      clickOutsideNotClose
    >
      {createType === SupportedCreationMethods.APIKEY && <MultiSteps currentStep={currentStep} />}
      {currentStep === ApiKeyStep.Verify && (
        <>
          {apiKeyCredentialsSchema.length > 0 && (
            <div className='mb-4'>
              <BaseForm
                formSchemas={apiKeyCredentialsSchema}
                ref={apiKeyCredentialsFormRef}
                labelClassName='system-sm-medium mb-2 flex items-center gap-1 text-text-primary'
                preventDefaultSubmit={true}
                formClassName='space-y-4'
                onChange={handleApiKeyCredentialsChange}
              />
            </div>
          )}
        </>
      )}
      {currentStep === ApiKeyStep.Configuration && <div className='max-h-[70vh]'>
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
              showCopy: true,
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
            formSchemas={autoCommonParametersSchema.map((schema) => {
              const normalizedType = normalizeFormType(schema.type as FormTypeEnum | string)
              return {
                ...schema,
                tooltip: schema.description,
                type: normalizedType,
                dynamicSelectParams: normalizedType === FormTypeEnum.dynamicSelect ? {
                  plugin_id: detail?.plugin_id || '',
                  provider: detail?.provider || '',
                  action: 'provider',
                  parameter: schema.name,
                  credential_id: subscriptionBuilder?.id || '',
                } : undefined,
                fieldClassName: schema.type === FormTypeEnum.boolean ? 'flex items-center justify-between' : undefined,
                labelClassName: schema.type === FormTypeEnum.boolean ? 'mb-0' : undefined,
              }
            })}
            ref={autoCommonParametersFormRef}
            labelClassName='system-sm-medium mb-2 flex items-center gap-1 text-text-primary'
            formClassName='space-y-4'
          />
        )}
        {createType === SupportedCreationMethods.MANUAL && <>
          {manualPropertiesSchema.length > 0 && (
            <div className='mb-6'>
              <BaseForm
                formSchemas={manualPropertiesSchema.map(schema => ({
                  ...schema,
                  tooltip: schema.description,
                }))}
                ref={manualPropertiesFormRef}
                labelClassName='system-sm-medium mb-2 flex items-center gap-1 text-text-primary'
                formClassName='space-y-4'
                onChange={handleManualPropertiesChange}
              />
            </div>
          )}
          <div className='mb-6'>
            <div className='mb-3 flex items-center gap-2'>
              <div className='system-xs-medium-uppercase text-text-tertiary'>
                {t('pluginTrigger.modal.manual.logs.title')}
              </div>
              <div className='h-px flex-1 bg-gradient-to-r from-divider-regular to-transparent' />
            </div>

            <div className='mb-1 flex items-center justify-center gap-1 rounded-lg bg-background-section p-3'>
              <div className='h-3.5 w-3.5'>
                <RiLoader2Line className='h-full w-full animate-spin' />
              </div>
              <div className='system-xs-regular text-text-tertiary'>
                {t('pluginTrigger.modal.manual.logs.loading', { pluginName: detail?.name || '' })}
              </div>
            </div>
            <LogViewer logs={logData?.logs || []} />
          </div>
        </>}
      </div>}
    </Modal>
  )
}
