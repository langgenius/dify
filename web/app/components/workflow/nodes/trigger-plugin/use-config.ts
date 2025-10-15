import { useCallback, useMemo } from 'react'
import produce from 'immer'
import type { PluginTriggerNodeType } from './types'
import type { PluginTriggerVarInputs } from './types'
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
import type { Event } from '@/app/components/tools/types'
import { VarKindType } from '../_base/types'

const useConfig = (id: string, payload: PluginTriggerNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { data: triggerPlugins = [] } = useAllTriggerPlugins()

  const { inputs, setInputs: doSetInputs } = useNodeCrud<PluginTriggerNodeType>(
    id,
    payload,
  )

  const {
    provider_id,
    provider_name,
    event_name: event_name,
    config = {},
    event_parameters = {},
  } = inputs

  // Construct provider for authentication check
  const authProvider = useMemo(() => {
    return provider_name || ''
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

  const currentEvent = useMemo<Event | undefined>(() => {
    return currentProvider?.events.find(
      event => event.name === event_name,
    )
  }, [currentProvider, event_name])

  // Dynamic trigger parameters (from specific trigger.parameters)
  const triggerSpecificParameterSchema = useMemo(() => {
    if (!currentEvent) return []
    return toolParametersToFormSchemas(currentEvent.parameters)
  }, [currentEvent])

  // Combined parameter schema (subscription + trigger specific)
  const triggerParameterSchema = useMemo(() => {
    const schemaMap = new Map()

    triggerSpecificParameterSchema.forEach((schema) => {
      schemaMap.set(schema.variable || schema.name, schema)
    })

    return Array.from(schemaMap.values())
  }, [triggerSpecificParameterSchema])

  const triggerParameterValue = useMemo(() => {
    if (!triggerParameterSchema.length)
      return {}

    const hasNewParameters = event_parameters && Object.keys(event_parameters).length > 0
    const baseValue = hasNewParameters ? event_parameters : (config || {})

    return addDefaultValue(baseValue, triggerParameterSchema)
  }, [triggerParameterSchema, event_parameters, config])

  const setTriggerParameterValue = useCallback(
    (value: Record<string, any>) => {
      const newInputs = produce(inputs, (draft) => {
        draft.event_parameters = value
        draft.config = value
      })
      doSetInputs(newInputs)
    },
    [inputs, doSetInputs],
  )

  const setInputVar = useCallback(
    (variable: InputVar, varDetail: InputVar) => {
      const newInputs = produce(inputs, (draft) => {
        const nextEventParameters = {
          ...(draft.event_parameters || {}),
        } as PluginTriggerVarInputs

        nextEventParameters[variable.variable] = {
          type: VarKindType.variable,
          value: varDetail.variable,
        }

        draft.event_parameters = nextEventParameters
        draft.config = {
          ...nextEventParameters,
          [variable.variable]: varDetail.variable,
        }
      })
      doSetInputs(newInputs)
    },
    [inputs, doSetInputs],
  )

  // Get output schema
  const outputSchema = useMemo(() => {
    return currentEvent?.output_schema || {}
  }, [currentEvent])

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

  return {
    readOnly,
    inputs,
    currentProvider,
    currentTrigger: currentEvent,
    triggerParameterSchema,
    triggerParameterValue,
    setTriggerParameterValue,
    setInputVar,
    outputSchema,
    hasObjectOutput,
    isAuthenticated,
    showAuthRequired,
  }
}

export default useConfig
