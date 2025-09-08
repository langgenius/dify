'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addDefaultValue, toolCredentialToFormSchemas, toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import type { Tool } from '@/app/components/tools/types'
import Drawer from '@/app/components/base/drawer-plus'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import Loading from '@/app/components/base/loading'
import Input from '@/app/components/base/input'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import TriggerForm from './trigger-form'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import {
  useBuildTriggerSubscription,
  useCreateTriggerSubscriptionBuilder,
  useInvalidateTriggerSubscriptions,
  useUpdateTriggerSubscriptionBuilder,
  useVerifyTriggerSubscriptionBuilder,
} from '@/service/use-triggers'
import { useToastContext } from '@/app/components/base/toast'
import { findMissingRequiredField, sanitizeFormValues } from '../utils/form-helpers'

type UnifiedApiKeyConfigModalProps = {
  provider: TriggerWithProvider
  trigger?: Tool
  onCancel: () => void
  onSuccess: () => void
}

enum ConfigStep {
  CREDENTIALS = 'credentials',
  VERIFYING = 'verifying',
  PARAMETERS = 'parameters',
  BUILDING = 'building',
}

const UnifiedApiKeyConfigModal: FC<UnifiedApiKeyConfigModalProps> = ({
  provider,
  trigger,
  onCancel,
  onSuccess,
}) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const language = useLanguage()

  // Form schemas
  const [credentialSchema, setCredentialSchema] = useState<any[]>([])
  const [parameterSchema, setParameterSchema] = useState<any[]>([])

  // Form values
  const [credentialValues, setCredentialValues] = useState<Record<string, any>>({})
  const [parameterValues, setParameterValues] = useState<Record<string, any>>({})
  const [subscriptionName, setSubscriptionName] = useState('')

  // State management
  const [currentStep, setCurrentStep] = useState<ConfigStep>(ConfigStep.CREDENTIALS)
  const [isLoading, setIsLoading] = useState(false)
  const [subscriptionBuilderId, setSubscriptionBuilderId] = useState<string>('')

  // API hooks
  const createBuilder = useCreateTriggerSubscriptionBuilder()
  const updateBuilder = useUpdateTriggerSubscriptionBuilder()
  const verifyBuilder = useVerifyTriggerSubscriptionBuilder()
  const buildSubscription = useBuildTriggerSubscription()
  const invalidateSubscriptions = useInvalidateTriggerSubscriptions()

  const providerPath = `${provider.plugin_id}/${provider.name}`

  // Initialize form schemas
  useEffect(() => {
    // Credential schema
    if (provider.credentials_schema) {
      const schemas = toolCredentialToFormSchemas(provider.credentials_schema as any)
      setCredentialSchema(schemas)
      const defaultCredentials = addDefaultValue({}, schemas)
      setCredentialValues(sanitizeFormValues(defaultCredentials))
    }

    // Parameter schema - combine subscription and trigger parameters
    const allParameterSchemas = []

    // Subscription parameters
    if (provider.subscription_schema?.parameters_schema) {
      const subscriptionParams = toolParametersToFormSchemas(
        provider.subscription_schema.parameters_schema as any,
      )
      allParameterSchemas.push(...subscriptionParams)
    }

    // Trigger-specific parameters
    if (trigger?.parameters) {
      const triggerParams = toolParametersToFormSchemas(trigger.parameters)
      allParameterSchemas.push(...triggerParams)
    }

    setParameterSchema(allParameterSchemas)
    if (allParameterSchemas.length > 0) {
      const defaultParameters = addDefaultValue({}, allParameterSchemas)
      setParameterValues(sanitizeFormValues(defaultParameters))
    }
  }, [provider, trigger])

  // Validation helper
  const validateRequiredFields = useCallback((values: Record<string, any>, schema: any[]) => {
    const requiredFields = schema
      .filter(field => field.required)
      .map(field => ({
        name: field.name,
        label: field.label[language] || field.label.en_US,
      }))

    return findMissingRequiredField(values, requiredFields)
  }, [language])

  // Final step: Build subscription
  const handleBuild = useCallback(async (builderId: string) => {
    try {
      await buildSubscription.mutateAsync({
        provider: providerPath,
        subscriptionBuilderId: builderId,
        name: subscriptionName.trim(),
      })

      // Success - invalidate cache and notify
      invalidateSubscriptions(providerPath)
      notify({
        type: 'success',
        message: t('workflow.nodes.triggerPlugin.subscriptionConfigured'),
      })
      onSuccess()
    }
    catch (error: any) {
      notify({
        type: 'error',
        message: t('workflow.nodes.triggerPlugin.subscriptionBuildFailed', { error: error.message }),
      })
      // Stay on current step to allow retry
    }
  }, [buildSubscription, providerPath, invalidateSubscriptions, notify, t, onSuccess, subscriptionName])

  // Step 1: Handle credentials configuration and creation
  const handleCredentialsNext = useCallback(async () => {
    // Validate subscription name first
    if (!subscriptionName.trim()) {
      Toast.notify({
        type: 'error',
        message: t('common.errorMsg.fieldRequired', { field: t('workflow.nodes.triggerPlugin.subscriptionName') }),
      })
      return
    }

    // Validate credentials
    const missingField = validateRequiredFields(credentialValues, credentialSchema)
    if (missingField) {
      Toast.notify({
        type: 'error',
        message: t('common.errorMsg.fieldRequired', { field: missingField.label }),
      })
      return
    }

    setIsLoading(true)
    setCurrentStep(ConfigStep.VERIFYING)

    try {
      // Create subscription builder with credential type only
      const createResponse = await createBuilder.mutateAsync({
        provider: providerPath,
        credential_type: 'api-key',
      })

      setSubscriptionBuilderId(createResponse.subscription_builder.id)

      // Auto-verify credentials with credential values
      await verifyBuilder.mutateAsync({
        provider: providerPath,
        subscriptionBuilderId: createResponse.subscription_builder.id,
        credentials: credentialValues,
      })

      // Move to parameters step if we have parameters to configure
      if (parameterSchema.length > 0) {
        setCurrentStep(ConfigStep.PARAMETERS)
      }
      else {
        // No parameters, proceed directly to build
        await handleBuild(createResponse.subscription_builder.id)
      }
    }
    catch (error: any) {
      notify({
        type: 'error',
        message: t('workflow.nodes.triggerPlugin.credentialVerificationFailed', { error: error.message }),
      })
      setCurrentStep(ConfigStep.CREDENTIALS) // Go back to credentials step
    }
    finally {
      setIsLoading(false)
    }
  }, [
    credentialValues,
    credentialSchema,
    subscriptionName,
    parameterSchema.length,
    validateRequiredFields,
    createBuilder,
    verifyBuilder,
    providerPath,
    notify,
    t,
  ])

  // Step 2: Handle parameters configuration
  const handleParametersNext = useCallback(async () => {
    // Validate parameters
    const missingField = validateRequiredFields(parameterValues, parameterSchema)
    if (missingField) {
      Toast.notify({
        type: 'error',
        message: t('common.errorMsg.fieldRequired', { field: missingField.label }),
      })
      return
    }

    setIsLoading(true)
    setCurrentStep(ConfigStep.BUILDING)

    try {
      // Update builder with parameters and the user-provided name
      await updateBuilder.mutateAsync({
        provider: providerPath,
        subscriptionBuilderId,
        name: subscriptionName.trim(),
        parameters: parameterValues,
      })

      // Build final subscription
      await handleBuild(subscriptionBuilderId)
    }
    catch (error: any) {
      notify({
        type: 'error',
        message: t('workflow.nodes.triggerPlugin.parameterConfigurationFailed', { error: error.message }),
      })
      setCurrentStep(ConfigStep.PARAMETERS) // Go back to parameters step
    }
    finally {
      setIsLoading(false)
    }
  }, [
    parameterValues,
    parameterSchema,
    subscriptionBuilderId,
    validateRequiredFields,
    updateBuilder,
    providerPath,
    notify,
    t,
  ])

  // Handle back button
  const handleBack = useCallback(() => {
    if (currentStep === ConfigStep.PARAMETERS)
      setCurrentStep(ConfigStep.CREDENTIALS)
  }, [currentStep])

  // Render step content
  const renderStepContent = () => {
    switch (currentStep) {
      case ConfigStep.CREDENTIALS:
        return (
          <>
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-text-secondary">
                {t('workflow.nodes.triggerPlugin.subscriptionName')}
                <span className="ml-1 text-text-destructive">*</span>
              </label>
              <Input
                value={subscriptionName}
                onChange={e => setSubscriptionName(e.target.value)}
                placeholder={t('workflow.nodes.triggerPlugin.subscriptionNamePlaceholder')}
                className="w-full"
              />
            </div>

            {credentialSchema.length > 0 && (
              <Form
                value={credentialValues}
                onChange={setCredentialValues}
                formSchemas={credentialSchema}
                isEditMode={true}
                showOnVariableMap={{}}
                validating={false}
                inputClassName='!bg-components-input-bg-normal'
                fieldMoreInfo={item => item.url ? (
                  <a
                    href={item.url}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='inline-flex items-center text-xs text-text-accent'
                  >
                    {t('tools.howToGet')}
                    <LinkExternal02 className='ml-1 h-3 w-3' />
                  </a>
                ) : null}
              />
            )}

            {parameterSchema.length > 0 && (
              <div className="mt-4 rounded-lg bg-background-section-burn p-3">
                <div className="text-sm text-text-secondary">
                  {t('workflow.nodes.triggerPlugin.parametersPreview')}
                </div>
                <div className="mt-1 text-xs text-text-tertiary">
                  {parameterSchema.map(param => param.label[language] || param.label.en_US).join(', ')}
                </div>
              </div>
            )}
          </>
        )

      case ConfigStep.VERIFYING:
        return (
          <div className="flex flex-col items-center justify-center py-8">
            <Loading type="app" />
            <div className="mt-4 text-sm text-text-secondary">
              {t('workflow.nodes.triggerPlugin.verifyingCredentials')}
            </div>
          </div>
        )

      case ConfigStep.PARAMETERS:
        return (
          <TriggerForm
            readOnly={false}
            nodeId="unified-config-modal"
            schema={parameterSchema}
            value={parameterValues}
            onChange={setParameterValues}
            inPanel={false}
            currentTrigger={trigger}
            currentProvider={provider}
          />
        )

      case ConfigStep.BUILDING:
        return (
          <div className="flex flex-col items-center justify-center py-8">
            <Loading type="app" />
            <div className="mt-4 text-sm text-text-secondary">
              {t('workflow.nodes.triggerPlugin.buildingSubscription')}
            </div>
          </div>
        )

      default:
        return null
    }
  }

  // Render action buttons
  const renderActions = () => {
    const isProcessing = currentStep === ConfigStep.VERIFYING || currentStep === ConfigStep.BUILDING

    return (
      <div className="flex justify-between space-x-2">
        <div>
          {currentStep === ConfigStep.PARAMETERS && (
            <Button onClick={handleBack} disabled={isLoading}>
              {t('common.operation.back')}
            </Button>
          )}
        </div>

        <div className="flex space-x-2">
          <Button onClick={onCancel} disabled={isProcessing}>
            {t('common.operation.cancel')}
          </Button>

          {currentStep === ConfigStep.CREDENTIALS && (
            <Button
              loading={isLoading}
              disabled={isLoading}
              variant="primary"
              onClick={handleCredentialsNext}
            >
              {parameterSchema.length > 0
                ? t('common.operation.next')
                : t('common.operation.save')
              }
            </Button>
          )}

          {currentStep === ConfigStep.PARAMETERS && (
            <Button
              loading={isLoading}
              disabled={isLoading}
              variant="primary"
              onClick={handleParametersNext}
            >
              {t('common.operation.save')}
            </Button>
          )}
        </div>
      </div>
    )
  }

  // Get step title
  const getStepTitle = () => {
    switch (currentStep) {
      case ConfigStep.CREDENTIALS:
        return t('workflow.nodes.triggerPlugin.configureCredentials')
      case ConfigStep.VERIFYING:
        return t('workflow.nodes.triggerPlugin.verifyingCredentials')
      case ConfigStep.PARAMETERS:
        return t('workflow.nodes.triggerPlugin.configureParameters')
      case ConfigStep.BUILDING:
        return t('workflow.nodes.triggerPlugin.buildingSubscription')
      default:
        return t('workflow.nodes.triggerPlugin.configureApiKey')
    }
  }

  return (
    <Drawer
      isShow
      onHide={onCancel}
      title={getStepTitle()}
      titleDescription={t('workflow.nodes.triggerPlugin.unifiedConfigDescription')}
      panelClassName='mt-[64px] mb-2 !w-[480px] border-components-panel-border'
      maxWidthClassName='!max-w-[480px]'
      height='calc(100vh - 64px)'
      contentClassName='!bg-components-panel-bg'
      headerClassName='!border-b-divider-subtle'
      body={
        <div className='flex h-full flex-col px-6 py-3'>
          <div className="flex-1 overflow-y-auto">
            {renderStepContent()}
          </div>

          <div className="mt-4 border-t border-divider-subtle pt-4">
            {renderActions()}
          </div>
        </div>
      }
      isShowMask={true}
      clickOutsideNotOpen={false}
    />
  )
}

export default React.memo(UnifiedApiKeyConfigModal)
