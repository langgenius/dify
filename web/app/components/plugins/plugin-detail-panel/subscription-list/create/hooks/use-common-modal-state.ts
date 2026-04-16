'use client'
import type { SimpleDetail } from '../../../store'
import type { SchemaItem } from '../components/modal-steps'
import type { FormRefObject } from '@/app/components/base/form/types'
import type { TriggerLogEntity, TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import { debounce } from 'es-toolkit/compat'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/components/base/ui/toast'
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
import { usePluginStore } from '../../../store'
import { useSubscriptionList } from '../../use-subscription-list'
import {
  buildSubscriptionPayload,
  getConfirmButtonText,
  getFirstFieldName,
  getFormValues,
  toSchemaWithTooltip,
  useInitializeSubscriptionBuilder,
  useSyncSubscriptionEndpoint,
} from './use-common-modal-state.helpers'

// ============================================================================
// Types
// ============================================================================

export enum ApiKeyStep {
  Verify = 'verify',
  Configuration = 'configuration',
}

const CREDENTIAL_TYPE_MAP: Record<SupportedCreationMethods, TriggerCredentialTypeEnum> = {
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

  const apiKeyCredentialsSchema = useMemo<SchemaItem[]>(() => {
    const rawSchema = detail?.declaration?.trigger?.subscription_constructor?.credentials_schema || []
    return toSchemaWithTooltip(rawSchema) as SchemaItem[]
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
            toast.error(errorMessage)
          },
        },
      )
    }, 500),
    [updateBuilder, t],
  )

  useInitializeSubscriptionBuilder({
    createBuilder,
    credentialType: CREDENTIAL_TYPE_MAP[createType],
    provider: detail?.provider,
    subscriptionBuilder,
    setSubscriptionBuilder,
    t,
  })

  // Cleanup debounced function
  useEffect(() => {
    return () => {
      debouncedUpdate.cancel()
    }
  }, [debouncedUpdate])

  useSyncSubscriptionEndpoint({
    endpoint: subscriptionBuilder?.endpoint,
    isConfigurationStep: currentStep === ApiKeyStep.Configuration,
    subscriptionFormRef,
    t,
  })

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
      name: apiKeyCredentialsSchema[0]!.name,
      errors: [],
    }])
  }, [apiKeyCredentialsSchema])

  // Handle verify
  const handleVerify = useCallback(() => {
    // Guard against uninitialized state
    if (!detail?.provider || !subscriptionBuilder?.id) {
      toast.error('Subscription builder not initialized')
      return
    }

    const apiKeyCredentialsFormValues = getFormValues(apiKeyCredentialsFormRef)
    const credentials = apiKeyCredentialsFormValues.values

    if (!Object.keys(credentials).length) {
      toast.error('Please fill in all required credentials')
      return
    }

    const credentialFieldName = getFirstFieldName(credentials, apiKeyCredentialsSchema)

    apiKeyCredentialsFormRef.current?.setFields([{
      name: credentialFieldName,
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
          toast.success(t('modal.apiKey.verify.success', { ns: 'pluginTrigger' }))
          setCurrentStep(ApiKeyStep.Configuration)
        },
        onError: async (error: unknown) => {
          const errorMessage = await parsePluginErrorMessage(error) || t('modal.apiKey.verify.error', { ns: 'pluginTrigger' })
          apiKeyCredentialsFormRef.current?.setFields([{
            name: credentialFieldName,
            errors: [errorMessage],
          }])
        },
      },
    )
  }, [apiKeyCredentialsSchema, detail?.provider, subscriptionBuilder?.id, verifyCredentials, t])

  // Handle create
  const handleCreate = useCallback(() => {
    if (!subscriptionBuilder) {
      toast.error('Subscription builder not found')
      return
    }

    const params = buildSubscriptionPayload({
      provider: detail?.provider || '',
      subscriptionBuilderId: subscriptionBuilder.id,
      createType,
      subscriptionFormValues: getFormValues(subscriptionFormRef),
      autoCommonParametersSchemaLength: autoCommonParametersSchema.length,
      autoCommonParametersFormValues: getFormValues(autoCommonParametersFormRef),
      manualPropertiesSchemaLength: manualPropertiesSchema.length,
      manualPropertiesFormValues: getFormValues(manualPropertiesFormRef),
    })

    if (!params)
      return

    buildSubscription(
      params,
      {
        onSuccess: () => {
          toast.success(t('subscription.createSuccess', { ns: 'pluginTrigger' }))
          onClose()
          refetch?.()
        },
        onError: async (error: unknown) => {
          const errorMessage = await parsePluginErrorMessage(error) || t('subscription.createFailed', { ns: 'pluginTrigger' })
          toast.error(errorMessage)
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
    return getConfirmButtonText({
      isVerifyStep: currentStep === ApiKeyStep.Verify,
      isVerifyingCredentials,
      isBuilding,
      t,
    })
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
