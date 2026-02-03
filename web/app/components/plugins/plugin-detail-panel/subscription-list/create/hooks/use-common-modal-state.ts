'use client'
import type { SimpleDetail } from '../../../store'
import type { SchemaItem } from '../components/modal-steps'
import type { FormRefObject } from '@/app/components/base/form/types'
import type { TriggerLogEntity, TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import type { BuildTriggerSubscriptionPayload } from '@/service/use-triggers'
import { debounce } from 'es-toolkit/compat'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import { TriggerCredentialTypeEnum } from '@/app/components/workflow/block-selector/types'
import {
  useBuildTriggerSubscription,
  useCreateTriggerSubscriptionBuilder,
  useTriggerSubscriptionBuilderLogs,
  useUpdateTriggerSubscriptionBuilder,
  useVerifyAndUpdateTriggerSubscriptionBuilder,
} from '@/service/use-triggers'
import { parsePluginErrorMessage } from '@/utils/error-parser'
import { isPrivateOrLocalAddress } from '@/utils/urlValidation'
import { usePluginStore } from '../../../store'
import { useSubscriptionList } from '../../use-subscription-list'

// ============================================================================
// Types
// ============================================================================

export enum ApiKeyStep {
  Verify = 'verify',
  Configuration = 'configuration',
}

export const CREDENTIAL_TYPE_MAP: Record<SupportedCreationMethods, TriggerCredentialTypeEnum> = {
  [SupportedCreationMethods.APIKEY]: TriggerCredentialTypeEnum.ApiKey,
  [SupportedCreationMethods.OAUTH]: TriggerCredentialTypeEnum.Oauth2,
  [SupportedCreationMethods.MANUAL]: TriggerCredentialTypeEnum.Unauthorized,
}

export const MODAL_TITLE_KEY_MAP: Record<
  SupportedCreationMethods,
  'modal.apiKey.title' | 'modal.oauth.title' | 'modal.manual.title'
> = {
  [SupportedCreationMethods.APIKEY]: 'modal.apiKey.title',
  [SupportedCreationMethods.OAUTH]: 'modal.oauth.title',
  [SupportedCreationMethods.MANUAL]: 'modal.manual.title',
}

type UseCommonModalStateParams = {
  createType: SupportedCreationMethods
  builder?: TriggerSubscriptionBuilder
  onClose: () => void
}

type FormRefs = {
  manualPropertiesFormRef: React.RefObject<FormRefObject | null>
  subscriptionFormRef: React.RefObject<FormRefObject | null>
  autoCommonParametersFormRef: React.RefObject<FormRefObject | null>
  apiKeyCredentialsFormRef: React.RefObject<FormRefObject | null>
}

type UseCommonModalStateReturn = {
  // State
  currentStep: ApiKeyStep
  subscriptionBuilder: TriggerSubscriptionBuilder | undefined
  isVerifyingCredentials: boolean
  isBuilding: boolean

  // Form refs
  formRefs: FormRefs

  // Computed values
  detail: SimpleDetail | undefined
  manualPropertiesSchema: SchemaItem[]
  autoCommonParametersSchema: SchemaItem[]
  apiKeyCredentialsSchema: SchemaItem[]
  logData: { logs: TriggerLogEntity[] } | undefined
  confirmButtonText: string

  // Handlers
  handleVerify: () => void
  handleCreate: () => void
  handleConfirm: () => void
  handleManualPropertiesChange: () => void
  handleApiKeyCredentialsChange: () => void
}

const DEFAULT_FORM_VALUES = { values: {}, isCheckValidated: false }

// ============================================================================
// Hook Implementation
// ============================================================================

export const useCommonModalState = ({
  createType,
  builder,
  onClose,
}: UseCommonModalStateParams): UseCommonModalStateReturn => {
  const { t } = useTranslation()
  const detail = usePluginStore(state => state.detail)
  const { refetch } = useSubscriptionList()

  // State
  const [currentStep, setCurrentStep] = useState<ApiKeyStep>(
    createType === SupportedCreationMethods.APIKEY ? ApiKeyStep.Verify : ApiKeyStep.Configuration,
  )
  const [subscriptionBuilder, setSubscriptionBuilder] = useState<TriggerSubscriptionBuilder | undefined>(builder)
  const isInitializedRef = useRef(false)

  // Form refs
  const manualPropertiesFormRef = useRef<FormRefObject>(null)
  const subscriptionFormRef = useRef<FormRefObject>(null)
  const autoCommonParametersFormRef = useRef<FormRefObject>(null)
  const apiKeyCredentialsFormRef = useRef<FormRefObject>(null)

  // Mutations
  const { mutate: verifyCredentials, isPending: isVerifyingCredentials } = useVerifyAndUpdateTriggerSubscriptionBuilder()
  const { mutateAsync: createBuilder } = useCreateTriggerSubscriptionBuilder()
  const { mutate: buildSubscription, isPending: isBuilding } = useBuildTriggerSubscription()
  const { mutate: updateBuilder } = useUpdateTriggerSubscriptionBuilder()

  // Schemas
  const manualPropertiesSchema = detail?.declaration?.trigger?.subscription_schema || []
  const autoCommonParametersSchema = detail?.declaration.trigger?.subscription_constructor?.parameters || []

  const apiKeyCredentialsSchema = useMemo(() => {
    const rawSchema = detail?.declaration?.trigger?.subscription_constructor?.credentials_schema || []
    return rawSchema.map(schema => ({
      ...schema,
      tooltip: schema.help,
    }))
  }, [detail?.declaration?.trigger?.subscription_constructor?.credentials_schema])

  // Log data for manual mode
  const { data: logData } = useTriggerSubscriptionBuilderLogs(
    detail?.provider || '',
    subscriptionBuilder?.id || '',
    {
      enabled: createType === SupportedCreationMethods.MANUAL,
      refetchInterval: 3000,
    },
  )

  // Debounced update for manual properties
  const debouncedUpdate = useMemo(
    () => debounce((provider: string, builderId: string, properties: Record<string, unknown>) => {
      updateBuilder(
        {
          provider,
          subscriptionBuilderId: builderId,
          properties,
        },
        {
          onError: async (error: unknown) => {
            const errorMessage = await parsePluginErrorMessage(error) || t('modal.errors.updateFailed', { ns: 'pluginTrigger' })
            console.error('Failed to update subscription builder:', error)
            Toast.notify({
              type: 'error',
              message: errorMessage,
            })
          },
        },
      )
    }, 500),
    [updateBuilder, t],
  )

  // Initialize builder
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
          message: t('modal.errors.createFailed', { ns: 'pluginTrigger' }),
        })
      }
    }
    if (!isInitializedRef.current && !subscriptionBuilder && detail?.provider)
      initializeBuilder()
  }, [subscriptionBuilder, detail?.provider, createType, createBuilder, t])

  // Cleanup debounced function
  useEffect(() => {
    return () => {
      debouncedUpdate.cancel()
    }
  }, [debouncedUpdate])

  // Update endpoint in form when endpoint changes
  useEffect(() => {
    if (!subscriptionBuilder?.endpoint || !subscriptionFormRef.current || currentStep !== ApiKeyStep.Configuration)
      return

    const form = subscriptionFormRef.current.getForm()
    if (form)
      form.setFieldValue('callback_url', subscriptionBuilder.endpoint)

    const warnings = isPrivateOrLocalAddress(subscriptionBuilder.endpoint)
      ? [t('modal.form.callbackUrl.privateAddressWarning', { ns: 'pluginTrigger' })]
      : []

    subscriptionFormRef.current?.setFields([{
      name: 'callback_url',
      warnings,
    }])
  }, [subscriptionBuilder?.endpoint, currentStep, t])

  // Handle manual properties change
  const handleManualPropertiesChange = useCallback(() => {
    if (!subscriptionBuilder || !detail?.provider)
      return

    const formValues = manualPropertiesFormRef.current?.getFormValues({ needCheckValidatedValues: false })
      || { values: {}, isCheckValidated: true }

    debouncedUpdate(detail.provider, subscriptionBuilder.id, formValues.values)
  }, [subscriptionBuilder, detail?.provider, debouncedUpdate])

  // Handle API key credentials change
  const handleApiKeyCredentialsChange = useCallback(() => {
    if (!apiKeyCredentialsSchema.length)
      return
    apiKeyCredentialsFormRef.current?.setFields([{
      name: apiKeyCredentialsSchema[0].name,
      errors: [],
    }])
  }, [apiKeyCredentialsSchema])

  // Handle verify
  const handleVerify = useCallback(() => {
    // Guard against uninitialized state
    if (!detail?.provider || !subscriptionBuilder?.id) {
      Toast.notify({
        type: 'error',
        message: 'Subscription builder not initialized',
      })
      return
    }

    const apiKeyCredentialsFormValues = apiKeyCredentialsFormRef.current?.getFormValues({}) || DEFAULT_FORM_VALUES
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
        provider: detail.provider,
        subscriptionBuilderId: subscriptionBuilder.id,
        credentials,
      },
      {
        onSuccess: () => {
          Toast.notify({
            type: 'success',
            message: t('modal.apiKey.verify.success', { ns: 'pluginTrigger' }),
          })
          setCurrentStep(ApiKeyStep.Configuration)
        },
        onError: async (error: unknown) => {
          const errorMessage = await parsePluginErrorMessage(error) || t('modal.apiKey.verify.error', { ns: 'pluginTrigger' })
          apiKeyCredentialsFormRef.current?.setFields([{
            name: Object.keys(credentials)[0],
            errors: [errorMessage],
          }])
        },
      },
    )
  }, [detail?.provider, subscriptionBuilder?.id, verifyCredentials, t])

  // Handle create
  const handleCreate = useCallback(() => {
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
        const autoCommonParametersFormValues = autoCommonParametersFormRef.current?.getFormValues({}) || DEFAULT_FORM_VALUES
        if (!autoCommonParametersFormValues?.isCheckValidated)
          return
        params.parameters = autoCommonParametersFormValues.values
      }
    }
    else if (manualPropertiesSchema.length > 0) {
      const manualFormValues = manualPropertiesFormRef.current?.getFormValues({}) || DEFAULT_FORM_VALUES
      if (!manualFormValues?.isCheckValidated)
        return
    }

    buildSubscription(
      params,
      {
        onSuccess: () => {
          Toast.notify({
            type: 'success',
            message: t('subscription.createSuccess', { ns: 'pluginTrigger' }),
          })
          onClose()
          refetch?.()
        },
        onError: async (error: unknown) => {
          const errorMessage = await parsePluginErrorMessage(error) || t('subscription.createFailed', { ns: 'pluginTrigger' })
          Toast.notify({
            type: 'error',
            message: errorMessage,
          })
        },
      },
    )
  }, [
    subscriptionBuilder,
    detail?.provider,
    createType,
    autoCommonParametersSchema.length,
    manualPropertiesSchema.length,
    buildSubscription,
    onClose,
    refetch,
    t,
  ])

  // Handle confirm (dispatch based on step)
  const handleConfirm = useCallback(() => {
    if (currentStep === ApiKeyStep.Verify)
      handleVerify()
    else
      handleCreate()
  }, [currentStep, handleVerify, handleCreate])

  // Confirm button text
  const confirmButtonText = useMemo(() => {
    if (currentStep === ApiKeyStep.Verify) {
      return isVerifyingCredentials
        ? t('modal.common.verifying', { ns: 'pluginTrigger' })
        : t('modal.common.verify', { ns: 'pluginTrigger' })
    }
    return isBuilding
      ? t('modal.common.creating', { ns: 'pluginTrigger' })
      : t('modal.common.create', { ns: 'pluginTrigger' })
  }, [currentStep, isVerifyingCredentials, isBuilding, t])

  return {
    currentStep,
    subscriptionBuilder,
    isVerifyingCredentials,
    isBuilding,
    formRefs: {
      manualPropertiesFormRef,
      subscriptionFormRef,
      autoCommonParametersFormRef,
      apiKeyCredentialsFormRef,
    },
    detail,
    manualPropertiesSchema,
    autoCommonParametersSchema,
    apiKeyCredentialsSchema,
    logData,
    confirmButtonText,
    handleVerify,
    handleCreate,
    handleConfirm,
    handleManualPropertiesChange,
    handleApiKeyCredentialsChange,
  }
}
