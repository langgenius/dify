import type { PluginTriggerNodeType, PluginTriggerVarInputs } from './types'
import type { Event } from '@/app/components/tools/types'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import type { InputVar } from '@/app/components/workflow/types'
import { produce } from 'immer'
import { useCallback, useEffect, useMemo } from 'react'
import {
  getConfiguredValue,
  toolParametersToFormSchemas,
} from '@/app/components/tools/utils/to-form-schema'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  useAllTriggerPlugins,
  useTriggerSubscriptions,
} from '@/service/use-triggers'
import { VarKindType } from '../_base/types'

const normalizeEventParameters = (
  params: PluginTriggerVarInputs | Record<string, unknown> | null | undefined,
  { allowScalars = false }: { allowScalars?: boolean } = {},
): PluginTriggerVarInputs => {
  if (!params || typeof params !== 'object' || Array.isArray(params))
    return {} as PluginTriggerVarInputs

  return Object.entries(params).reduce((acc, [key, entry]) => {
    if (!entry && entry !== 0 && entry !== false)
      return acc

    if (
      typeof entry === 'object'
      && !Array.isArray(entry)
      && 'type' in entry
      && 'value' in entry
    ) {
      const normalizedEntry = { ...(entry as PluginTriggerVarInputs[string]) }
      if (normalizedEntry.type === VarKindType.mixed)
        normalizedEntry.type = VarKindType.constant
      acc[key] = normalizedEntry
      return acc
    }

    if (!allowScalars)
      return acc

    if (typeof entry === 'string') {
      acc[key] = {
        type: VarKindType.constant,
        value: entry,
      }
      return acc
    }

    if (typeof entry === 'number' || typeof entry === 'boolean') {
      acc[key] = {
        type: VarKindType.constant,
        value: entry,
      }
      return acc
    }

    if (Array.isArray(entry) && entry.every(item => typeof item === 'string')) {
      acc[key] = {
        type: VarKindType.variable,
        value: entry,
      }
    }

    return acc
  }, {} as PluginTriggerVarInputs)
}

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
    event_name,
    config = {},
    event_parameters: rawEventParameters = {},
    subscription_id,
  } = inputs

  const event_parameters = useMemo(
    () => normalizeEventParameters(rawEventParameters as PluginTriggerVarInputs),
    [rawEventParameters],
  )
  const legacy_config_parameters = useMemo(
    () => normalizeEventParameters(config as PluginTriggerVarInputs, { allowScalars: true }),
    [config],
  )

  const currentProvider = useMemo<TriggerWithProvider | undefined>(() => {
    return triggerPlugins.find(
      provider =>
        provider.name === provider_name
        || provider.id === provider_id
        || (provider_id && provider.plugin_id === provider_id),
    )
  }, [triggerPlugins, provider_name, provider_id])

  const { data: subscriptions = [] } = useTriggerSubscriptions(provider_id || '')

  const subscriptionSelected = useMemo(() => {
    return subscriptions?.find(s => s.id === subscription_id)
  }, [subscriptions, subscription_id])

  const currentEvent = useMemo<Event | undefined>(() => {
    return currentProvider?.events.find(
      event => event.name === event_name,
    )
  }, [currentProvider, event_name])

  // Dynamic trigger parameters (from specific trigger.parameters)
  const triggerSpecificParameterSchema = useMemo(() => {
    if (!currentEvent)
      return []
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
      return {} as PluginTriggerVarInputs

    const hasStoredParameters = event_parameters && Object.keys(event_parameters).length > 0
    const baseValue = hasStoredParameters ? event_parameters : legacy_config_parameters

    const configuredValue = getConfiguredValue(baseValue, triggerParameterSchema) as PluginTriggerVarInputs
    return normalizeEventParameters(configuredValue)
  }, [triggerParameterSchema, event_parameters, legacy_config_parameters])

  useEffect(() => {
    if (!triggerParameterSchema.length)
      return

    if (event_parameters && Object.keys(event_parameters).length > 0)
      return

    if (!triggerParameterValue || Object.keys(triggerParameterValue).length === 0)
      return

    const newInputs = produce(inputs, (draft) => {
      draft.event_parameters = triggerParameterValue
      draft.config = triggerParameterValue
    })
    doSetInputs(newInputs)
  }, [
    doSetInputs,
    event_parameters,
    inputs,
    triggerParameterSchema,
    triggerParameterValue,
  ])

  const setTriggerParameterValue = useCallback(
    (value: PluginTriggerVarInputs) => {
      const sanitizedValue = normalizeEventParameters(value)
      const newInputs = produce(inputs, (draft) => {
        draft.event_parameters = sanitizedValue
        draft.config = sanitizedValue
      })
      doSetInputs(newInputs)
    },
    [inputs, doSetInputs],
  )

  const setInputVar = useCallback(
    (variable: InputVar, varDetail: InputVar) => {
      const newInputs = produce(inputs, (draft) => {
        const nextEventParameters = normalizeEventParameters({
          ...draft.event_parameters,
          [variable.variable]: {
            type: VarKindType.variable,
            value: varDetail.variable,
          },
        } as PluginTriggerVarInputs)

        draft.event_parameters = nextEventParameters
        draft.config = nextEventParameters
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

  return {
    readOnly,
    inputs,
    currentProvider,
    currentEvent,
    triggerParameterSchema,
    triggerParameterValue,
    setTriggerParameterValue,
    setInputVar,
    outputSchema,
    hasObjectOutput,
    subscriptions,
    subscriptionSelected,
  }
}

export default useConfig
