import { useCallback, useMemo } from 'react'
import produce from 'immer'
import type { PluginTriggerNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import {
  useAllTriggerPlugins,
  useTriggerSubscriptions,
} from '@/service/use-triggers'
import {
  addDefaultValue,
  toolParametersToFormSchemas,
} from '@/app/components/tools/utils/to-form-schema'
import type { InputVar } from '@/app/components/workflow/types'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import type { Trigger } from '@/app/components/tools/types'

const useConfig = (id: string, payload: PluginTriggerNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { data: triggerPlugins = [] } = useAllTriggerPlugins()

  const { inputs, setInputs: doSetInputs } = useNodeCrud<PluginTriggerNodeType>(
    id,
    payload,
  )

  const { provider_id, provider_name, trigger_name, config } = inputs

  // Construct provider for authentication check
  const authProvider = useMemo(() => {
    if (provider_id && provider_name) return `${provider_id}/${provider_name}`
    return provider_id || ''
  }, [provider_id, provider_name])

  const { data: subscriptions = [] } = useTriggerSubscriptions(
    authProvider,
    !!authProvider,
  )

  const currentProvider = useMemo<TriggerWithProvider | undefined>(() => {
    return triggerPlugins.find(
      provider =>
        provider.name === provider_name
        || provider.id === provider_id
        || (provider_id && provider.plugin_id === provider_id),
    )
  }, [triggerPlugins, provider_name, provider_id])

  const currentTrigger = useMemo<Trigger | undefined>(() => {
    return currentProvider?.triggers.find(
      trigger => trigger.name === trigger_name,
    )
  }, [currentProvider, trigger_name])

  // Dynamic subscription parameters (from subscription_schema.parameters_schema)
  const subscriptionParameterSchema = useMemo(() => {
    if (!currentProvider?.subscription_schema?.parameters_schema) return []
    return toolParametersToFormSchemas(
      currentProvider.subscription_schema.parameters_schema as any,
    )
  }, [currentProvider])

  // Dynamic trigger parameters (from specific trigger.parameters)
  const triggerSpecificParameterSchema = useMemo(() => {
    if (!currentTrigger) return []
    return toolParametersToFormSchemas(currentTrigger.parameters)
  }, [currentTrigger])

  // Combined parameter schema (subscription + trigger specific)
  const triggerParameterSchema = useMemo(() => {
    return [...subscriptionParameterSchema, ...triggerSpecificParameterSchema]
  }, [subscriptionParameterSchema, triggerSpecificParameterSchema])

  const triggerParameterValue = useMemo(() => {
    if (!triggerParameterSchema.length) return {}
    return addDefaultValue(config || {}, triggerParameterSchema)
  }, [triggerParameterSchema, config])

  const setTriggerParameterValue = useCallback(
    (value: Record<string, any>) => {
      const newInputs = produce(inputs, (draft) => {
        draft.config = value
      })
      doSetInputs(newInputs)
    },
    [inputs, doSetInputs],
  )

  const setInputVar = useCallback(
    (variable: InputVar, varDetail: InputVar) => {
      const newInputs = produce(inputs, (draft) => {
        draft.config = {
          ...draft.config,
          [variable.variable]: varDetail.variable,
        }
      })
      doSetInputs(newInputs)
    },
    [inputs, doSetInputs],
  )

  // Get output schema
  const outputSchema = useMemo(() => {
    return currentTrigger?.output_schema || {}
  }, [currentTrigger])

  // Check if trigger has complex output structure
  const hasObjectOutput = useMemo(() => {
    const properties = outputSchema.properties || {}
    return Object.values(properties).some(
      (prop: any) => prop.type === 'object',
    )
  }, [outputSchema])

  // Authentication status check
  const isAuthenticated = useMemo(() => {
    if (!subscriptions.length) return false
    const subscription = subscriptions[0]
    return subscription.credential_type !== 'unauthorized'
  }, [subscriptions])

  const showAuthRequired = !isAuthenticated && !!currentProvider

  // Check supported authentication methods
  const supportedAuthMethods = useMemo(() => {
    if (!currentProvider) return []

    const methods = []

    if (
      currentProvider.oauth_client_schema
      && currentProvider.oauth_client_schema.length > 0
    )
      methods.push('oauth')

    if (
      currentProvider.credentials_schema
      && currentProvider.credentials_schema.length > 0
    )
      methods.push('api_key')

    return methods
  }, [currentProvider])

  return {
    readOnly,
    inputs,
    currentProvider,
    currentTrigger,
    triggerParameterSchema,
    triggerParameterValue,
    setTriggerParameterValue,
    setInputVar,
    outputSchema,
    hasObjectOutput,
    isAuthenticated,
    showAuthRequired,
    supportedAuthMethods,
  }
}

export default useConfig
