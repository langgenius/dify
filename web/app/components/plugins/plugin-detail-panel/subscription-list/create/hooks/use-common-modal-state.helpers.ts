'use client'
import type { Dispatch, SetStateAction } from 'react'
import type { FormRefObject } from '@/app/components/base/form/types'
import type { TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import type { BuildTriggerSubscriptionPayload } from '@/service/use-triggers'
import { useEffect, useRef } from 'react'
import { toast } from '@/app/components/base/ui/toast'
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import { isPrivateOrLocalAddress } from '@/utils/urlValidation'

type FormValuesResult = {
  values: Record<string, unknown>
  isCheckValidated: boolean
}

type InitializeBuilderParams = {
  createBuilder: (params: {
    provider: string
    credential_type: string
  }) => Promise<{ subscription_builder: TriggerSubscriptionBuilder }>
  credentialType: string
  provider?: string
  subscriptionBuilder?: TriggerSubscriptionBuilder
  setSubscriptionBuilder: Dispatch<SetStateAction<TriggerSubscriptionBuilder | undefined>>
  t: (key: string, options?: Record<string, unknown>) => string
}

type SyncEndpointParams = {
  endpoint?: string
  isConfigurationStep: boolean
  subscriptionFormRef: React.RefObject<FormRefObject | null>
  t: (key: string, options?: Record<string, unknown>) => string
}

type BuildPayloadParams = {
  provider: string
  subscriptionBuilderId: string
  createType: SupportedCreationMethods
  subscriptionFormValues?: FormValuesResult
  autoCommonParametersSchemaLength: number
  autoCommonParametersFormValues?: FormValuesResult
  manualPropertiesSchemaLength: number
  manualPropertiesFormValues?: FormValuesResult
}

export const DEFAULT_FORM_VALUES: FormValuesResult = { values: {}, isCheckValidated: false }

export const getFormValues = (formRef: React.RefObject<FormRefObject | null>) => {
  return formRef.current?.getFormValues({}) || DEFAULT_FORM_VALUES
}

export const getFirstFieldName = (
  values: Record<string, unknown>,
  fallbackSchema: Array<{ name: string }>,
) => {
  return Object.keys(values)[0] || fallbackSchema[0]?.name || ''
}

export const toSchemaWithTooltip = <T extends { help?: unknown, name: string }>(schemas: T[] = []) => {
  return schemas.map(schema => ({
    ...schema,
    tooltip: schema.help,
  }))
}

export const buildSubscriptionPayload = ({
  provider,
  subscriptionBuilderId,
  createType,
  subscriptionFormValues,
  autoCommonParametersSchemaLength,
  autoCommonParametersFormValues,
  manualPropertiesSchemaLength,
  manualPropertiesFormValues,
}: BuildPayloadParams): BuildTriggerSubscriptionPayload | null => {
  if (!subscriptionFormValues?.isCheckValidated)
    return null

  const subscriptionNameValue = subscriptionFormValues.values.subscription_name as string

  const params: BuildTriggerSubscriptionPayload = {
    provider,
    subscriptionBuilderId,
    name: subscriptionNameValue,
  }

  if (createType !== SupportedCreationMethods.MANUAL) {
    if (!autoCommonParametersSchemaLength)
      return params

    if (!autoCommonParametersFormValues?.isCheckValidated)
      return null

    params.parameters = autoCommonParametersFormValues.values
    return params
  }

  if (manualPropertiesSchemaLength && !manualPropertiesFormValues?.isCheckValidated)
    return null

  return params
}

export const getConfirmButtonText = ({
  isVerifyStep,
  isVerifyingCredentials,
  isBuilding,
  t,
}: {
  isVerifyStep: boolean
  isVerifyingCredentials: boolean
  isBuilding: boolean
  t: (key: string, options?: Record<string, unknown>) => string
}) => {
  if (isVerifyStep) {
    return isVerifyingCredentials
      ? t('modal.common.verifying', { ns: 'pluginTrigger' })
      : t('modal.common.verify', { ns: 'pluginTrigger' })
  }

  return isBuilding
    ? t('modal.common.creating', { ns: 'pluginTrigger' })
    : t('modal.common.create', { ns: 'pluginTrigger' })
}

export const useInitializeSubscriptionBuilder = ({
  createBuilder,
  credentialType,
  provider,
  subscriptionBuilder,
  setSubscriptionBuilder,
  t,
}: InitializeBuilderParams) => {
  const isInitializedRef = useRef(false)

  useEffect(() => {
    const initializeBuilder = async () => {
      isInitializedRef.current = true
      try {
        const response = await createBuilder({
          provider: provider || '',
          credential_type: credentialType,
        })
        setSubscriptionBuilder(response.subscription_builder)
      }
      catch (error) {
        console.error('createBuilder error:', error)
        toast.error(t('modal.errors.createFailed', { ns: 'pluginTrigger' }))
      }
    }

    if (!isInitializedRef.current && !subscriptionBuilder && provider)
      initializeBuilder()
  }, [subscriptionBuilder, provider, credentialType, createBuilder, setSubscriptionBuilder, t])
}

export const useSyncSubscriptionEndpoint = ({
  endpoint,
  isConfigurationStep,
  subscriptionFormRef,
  t,
}: SyncEndpointParams) => {
  useEffect(() => {
    if (!endpoint || !subscriptionFormRef.current || !isConfigurationStep)
      return

    const form = subscriptionFormRef.current.getForm()
    if (form)
      form.setFieldValue('callback_url', endpoint)

    const warnings = isPrivateOrLocalAddress(endpoint)
      ? [t('modal.form.callbackUrl.privateAddressWarning', { ns: 'pluginTrigger' })]
      : []

    subscriptionFormRef.current.setFields([{
      name: 'callback_url',
      warnings,
    }])
  }, [endpoint, isConfigurationStep, subscriptionFormRef, t])
}
