import { useCallback, useMemo } from 'react'
import { useStore } from '../../store'
import type { PluginTriggerNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { CollectionType } from '@/app/components/tools/types'
import {
  toolParametersToFormSchemas,
} from '@/app/components/tools/utils/to-form-schema'
import {
  useFetchToolsData,
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import { canFindTool } from '@/utils'

const useConfig = (id: string, payload: PluginTriggerNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { handleFetchAllTools } = useFetchToolsData()

  const { inputs, setInputs } = useNodeCrud<PluginTriggerNodeType>(id, payload)
  const { provider_id, provider_type, tool_name, config = {}, paramSchemas = [] } = inputs

  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)
  const workflowTools = useStore(s => s.workflowTools)
  const mcpTools = useStore(s => s.mcpTools)

  const currentTools = useMemo(() => {
    switch (provider_type) {
      case CollectionType.builtIn:
        return buildInTools
      case CollectionType.custom:
        return customTools
      case CollectionType.workflow:
        return workflowTools
      case CollectionType.mcp:
        return mcpTools
      default:
        return []
    }
  }, [buildInTools, customTools, mcpTools, provider_type, workflowTools])

  const currCollection = currentTools.find(item => canFindTool(item.id, provider_id))
  const currTool = currCollection?.tools.find(tool => tool.name === tool_name)

  const isBuiltIn = provider_type === CollectionType.builtIn
  const needAuth = !!currCollection?.allow_delete
  const isAuthed = !!currCollection?.is_team_authorization
  const isShowAuthBtn = isBuiltIn && needAuth && !isAuthed

  const formSchemas = useMemo(() => {
    return paramSchemas.length > 0 ? toolParametersToFormSchemas(paramSchemas) : []
  }, [paramSchemas])

  const setConfig = useCallback((value: Record<string, any>) => {
    setInputs({
      ...inputs,
      config: value,
    })
  }, [inputs, setInputs])

  const hasPlugin = !!(provider_id && tool_name)

  return {
    readOnly,
    inputs,
    setInputs,
    currCollection,
    currTool,
    isShowAuthBtn,
    formSchemas,
    config,
    setConfig,
    hasPlugin,
    handleFetchAllTools,
  }
}

export default useConfig
