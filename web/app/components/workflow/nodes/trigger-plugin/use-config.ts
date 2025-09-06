import { useCallback, useMemo } from 'react'
import produce from 'immer'
import type { PluginTriggerNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import { useAllTriggerPlugins } from '@/service/use-triggers'
import {
  addDefaultValue,
  toolParametersToFormSchemas,
} from '@/app/components/tools/utils/to-form-schema'
import type { InputVar } from '@/app/components/workflow/types'
import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import type { Tool } from '@/app/components/tools/types'

const useConfig = (id: string, payload: PluginTriggerNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { data: triggerPlugins = [] } = useAllTriggerPlugins()

  const { inputs, setInputs: doSetInputs } = useNodeCrud<PluginTriggerNodeType>(id, payload)

  const { provider_id, provider_name, tool_name, config } = inputs
  const currentProvider = useMemo<TriggerWithProvider | undefined>(() => {
    return triggerPlugins.find(provider =>
      provider.name === provider_name
      || provider.id === provider_id
      || (provider_id && provider.plugin_id === provider_id),
    )
  }, [triggerPlugins, provider_name, provider_id])

  const currentTrigger = useMemo<Tool | undefined>(() => {
    return currentProvider?.tools.find(tool => tool.name === tool_name)
  }, [currentProvider, tool_name])

  const triggerParameterSchema = useMemo(() => {
    if (!currentTrigger) return []
    return toolParametersToFormSchemas(currentTrigger.parameters)
  }, [currentTrigger])

  const triggerParameterValue = useMemo(() => {
    if (!triggerParameterSchema.length) return {}
    return addDefaultValue(config || {}, triggerParameterSchema)
  }, [triggerParameterSchema, config])

  const setTriggerParameterValue = useCallback((value: Record<string, any>) => {
    const newInputs = produce(inputs, (draft) => {
      draft.config = value
    })
    doSetInputs(newInputs)
  }, [inputs, doSetInputs])

  const setInputVar = useCallback((variable: InputVar, varDetail: InputVar) => {
    const newInputs = produce(inputs, (draft) => {
      draft.config = {
        ...draft.config,
        [variable.variable]: varDetail.variable,
      }
    })
    doSetInputs(newInputs)
  }, [inputs, doSetInputs])

  // Get output schema
  const outputSchema = useMemo(() => {
    return currentTrigger?.output_schema || {}
  }, [currentTrigger])

  // Check if trigger has complex output structure
  const hasObjectOutput = useMemo(() => {
    const properties = outputSchema.properties || {}
    return Object.values(properties).some((prop: any) => prop.type === 'object')
  }, [outputSchema])

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
  }
}

export default useConfig
