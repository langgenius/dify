import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { produce } from 'immer'
import { useBoolean } from 'ahooks'
import { useWorkflowStore } from '../../store'
import type { ToolNodeType, ToolVarInputs } from './types'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { CollectionType } from '@/app/components/tools/types'
import { updateBuiltInToolCredential } from '@/service/tools'
import {
  getConfiguredValue,
  toolParametersToFormSchemas,
} from '@/app/components/tools/utils/to-form-schema'
import Toast from '@/app/components/base/toast'
import type { InputVar } from '@/app/components/workflow/types'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import { canFindTool } from '@/utils'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
  useInvalidToolsByType,
} from '@/service/use-tools'

const useConfig = (id: string, payload: ToolNodeType) => {
  const workflowStore = useWorkflowStore()
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { t } = useTranslation()

  const language = useLanguage()
  const { inputs, setInputs: doSetInputs } = useNodeCrud<ToolNodeType>(
    id,
    payload,
  )
  /*
   * tool_configurations: tool setting, not dynamic setting (form type = form)
   * tool_parameters: tool dynamic setting(form type = llm)
   */
  const {
    provider_id,
    provider_type,
    tool_name,
    tool_configurations,
    tool_parameters,
  } = inputs
  const isBuiltIn = provider_type === CollectionType.builtIn
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()

  const currentTools = useMemo(() => {
    switch (provider_type) {
      case CollectionType.builtIn:
        return buildInTools || []
      case CollectionType.custom:
        return customTools || []
      case CollectionType.workflow:
        return workflowTools || []
      case CollectionType.mcp:
        return mcpTools || []
      default:
        return []
    }
  }, [buildInTools, customTools, mcpTools, provider_type, workflowTools])
  const currCollection = useMemo(() => {
    return currentTools.find(item => canFindTool(item.id, provider_id))
  }, [currentTools, provider_id])

  // Auth
  const needAuth = !!currCollection?.allow_delete
  const isAuthed = !!currCollection?.is_team_authorization
  const isShowAuthBtn = isBuiltIn && needAuth && !isAuthed
  const [
    showSetAuth,
    { setTrue: showSetAuthModal, setFalse: hideSetAuthModal },
  ] = useBoolean(false)

  const invalidToolsByType = useInvalidToolsByType(provider_type)
  const handleSaveAuth = useCallback(
    async (value: any) => {
      await updateBuiltInToolCredential(currCollection?.name as string, value)

      Toast.notify({
        type: 'success',
        message: t('common.api.actionSuccess'),
      })
      invalidToolsByType()
      hideSetAuthModal()
    },
    [
      currCollection?.name,
      hideSetAuthModal,
      t,
      invalidToolsByType,
      provider_type,
    ],
  )

  const currTool = useMemo(() => {
    return currCollection?.tools.find(tool => tool.name === tool_name)
  }, [currCollection, tool_name])
  const formSchemas = useMemo(() => {
    return currTool ? toolParametersToFormSchemas(currTool.parameters) : []
  }, [currTool])
  const toolInputVarSchema = useMemo(() => {
    return formSchemas.filter((item: any) => item.form === 'llm')
  }, [formSchemas])
  // use setting
  const toolSettingSchema = useMemo(() => {
    return formSchemas.filter((item: any) => item.form !== 'llm')
  }, [formSchemas])
  const hasShouldTransferTypeSettingInput = toolSettingSchema.some(
    item => item.type === 'boolean' || item.type === 'number-input',
  )

  const setInputs = useCallback(
    (value: ToolNodeType) => {
      if (!hasShouldTransferTypeSettingInput) {
        doSetInputs(value)
        return
      }
      const newInputs = produce(value, (draft) => {
        const newConfig = { ...draft.tool_configurations }
        Object.keys(draft.tool_configurations).forEach((key) => {
          const schema = formSchemas.find(item => item.variable === key)
          const value = newConfig[key]
          if (schema?.type === 'boolean') {
            if (typeof value === 'string')
              newConfig[key] = value === 'true' || value === '1'

            if (typeof value === 'number') newConfig[key] = value === 1
          }

          if (schema?.type === 'number-input') {
            if (typeof value === 'string' && value !== '')
              newConfig[key] = Number.parseFloat(value)
          }
        })
        draft.tool_configurations = newConfig
      })
      doSetInputs(newInputs)
    },
    [doSetInputs, formSchemas, hasShouldTransferTypeSettingInput],
  )
  const [notSetDefaultValue, setNotSetDefaultValue] = useState(false)
  const toolSettingValue = useMemo(() => {
    if (notSetDefaultValue) return tool_configurations
    return getConfiguredValue(tool_configurations, toolSettingSchema)
  }, [notSetDefaultValue, toolSettingSchema, tool_configurations])
  const setToolSettingValue = useCallback(
    (value: Record<string, any>) => {
      setNotSetDefaultValue(true)
      setInputs({
        ...inputs,
        tool_configurations: value,
      })
    },
    [inputs, setInputs],
  )

  const formattingParameters = () => {
    const inputsWithDefaultValue = produce(inputs, (draft) => {
      if (
        !draft.tool_configurations
        || Object.keys(draft.tool_configurations).length === 0
      ) {
        draft.tool_configurations = getConfiguredValue(
          tool_configurations,
          toolSettingSchema,
        )
      }
      if (
        !draft.tool_parameters
        || Object.keys(draft.tool_parameters).length === 0
      ) {
        draft.tool_parameters = getConfiguredValue(
          tool_parameters,
          toolInputVarSchema,
        )
      }
    })
    return inputsWithDefaultValue
  }

  useEffect(() => {
    if (!currTool) return
    const inputsWithDefaultValue = formattingParameters()
    const { setControlPromptEditorRerenderKey } = workflowStore.getState()
    setInputs(inputsWithDefaultValue)
    setTimeout(() => setControlPromptEditorRerenderKey(Date.now()))
  }, [currTool])

  // setting when call
  const setInputVar = useCallback(
    (value: ToolVarInputs) => {
      setInputs({
        ...inputs,
        tool_parameters: value,
      })
    },
    [inputs, setInputs],
  )

  const isLoading = currTool && (isBuiltIn ? !currCollection : false)

  const getMoreDataForCheckValid = () => {
    return {
      toolInputsSchema: (() => {
        const formInputs: InputVar[] = []
        toolInputVarSchema.forEach((item: any) => {
          formInputs.push({
            label: item.label[language] || item.label.en_US,
            variable: item.variable,
            type: item.type,
            required: item.required,
          })
        })
        return formInputs
      })(),
      notAuthed: isShowAuthBtn,
      toolSettingSchema,
      language,
    }
  }

  const outputSchema = useMemo(() => {
    const res: any[] = []
    const output_schema = currTool?.output_schema
    if (!output_schema || !output_schema.properties) return res

    Object.keys(output_schema.properties).forEach((outputKey) => {
      const output = output_schema.properties[outputKey]
      const type = output.type
      if (type === 'object') {
        res.push({
          name: outputKey,
          value: output,
        })
      }
      else {
        res.push({
          name: outputKey,
          type:
            output.type === 'array'
              ? `Array[${output.items?.type
                ? output.items.type.slice(0, 1).toLocaleUpperCase()
                + output.items.type.slice(1)
                : 'Unknown'
              }]`
              : `${output.type
                ? output.type.slice(0, 1).toLocaleUpperCase()
                + output.type.slice(1)
                : 'Unknown'
              }`,
          description: output.description,
        })
      }
    })
    return res
  }, [currTool])

  const hasObjectOutput = useMemo(() => {
    const output_schema = currTool?.output_schema
    if (!output_schema || !output_schema.properties) return false
    const properties = output_schema.properties
    return Object.keys(properties).some(
      key => properties[key].type === 'object',
    )
  }, [currTool])

  return {
    readOnly,
    inputs,
    currTool,
    toolSettingSchema,
    toolSettingValue,
    setToolSettingValue,
    toolInputVarSchema,
    setInputVar,
    currCollection,
    isShowAuthBtn,
    showSetAuth,
    showSetAuthModal,
    hideSetAuthModal,
    handleSaveAuth,
    isLoading,
    outputSchema,
    hasObjectOutput,
    getMoreDataForCheckValid,
  }
}

export default useConfig
