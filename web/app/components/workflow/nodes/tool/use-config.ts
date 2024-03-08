import { useCallback, useEffect, useState } from 'react'
import type { ToolNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { fetchBuiltInToolList, fetchCustomToolList } from '@/service/tools'
import type { Tool } from '@/app/components/tools/types'
import { addDefaultValue, toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'

import { CollectionType } from '@/app/components/tools/types'

const useConfig = (id: string, payload: ToolNodeType) => {
  const { inputs, setInputs } = useNodeCrud<ToolNodeType>(id, payload)
  const { provider_id, provider_type, tool_name, tool_parameters } = inputs
  const isBuiltIn = provider_type === CollectionType.builtIn
  const [currTool, setCurrTool] = useState<Tool | null>(null)
  const formSchemas = currTool ? toolParametersToFormSchemas(currTool.parameters) : []
  // use setting
  const toolSettingSchema = formSchemas.filter((item: any) => item.form !== 'llm')
  const toolSettingValue = (() => {
    return addDefaultValue(tool_parameters, toolSettingSchema)
  })()
  const setToolSettingValue = useCallback((value: Record<string, any>) => {
    setInputs({
      ...inputs,
      tool_parameters: value,
    })
  }, [inputs, setInputs])

  // setting when call
  const toolInputSchema = formSchemas.filter((item: any) => item.form === 'llm')
  useEffect(() => {
    (async () => {
      const list = isBuiltIn ? await fetchBuiltInToolList(provider_id) : await fetchCustomToolList(provider_id)
      const currTool = list.find(tool => tool.name === tool_name)
      if (currTool)
        setCurrTool(currTool)
    })()
  }, [provider_id])
  return {
    inputs,
    currTool,
    toolSettingSchema,
    toolSettingValue,
    setToolSettingValue,
  }
}

export default useConfig
