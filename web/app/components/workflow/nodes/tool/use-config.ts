import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import { useBoolean } from 'ahooks'
import { useStore } from '../../store'
import { type ToolNodeType, type ToolVarInput, VarType } from './types'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { CollectionType } from '@/app/components/tools/types'
import type { Collection, Tool } from '@/app/components/tools/types'
import { fetchBuiltInToolList, fetchCollectionList, fetchCustomToolList, updateBuiltInToolCredential } from '@/service/tools'
import { addDefaultValue, toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import Toast from '@/app/components/base/toast'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import { InputVarType, VarType as VarVarType } from '@/app/components/workflow/types'
import type { InputVar, Var } from '@/app/components/workflow/types'
import useOneStepRun from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'
const useConfig = (id: string, payload: ToolNodeType) => {
  const { t } = useTranslation()
  const language = useLanguage()
  const toolsMap = useStore(s => s.toolsMap)
  const setToolsMap = useStore(s => s.setToolsMap)

  const { inputs, setInputs } = useNodeCrud<ToolNodeType>(id, payload)
  /*
  * tool_configurations: tool setting, not dynamic setting
  * tool_parameters: tool dynamic setting(by user)
  */
  const { provider_id, provider_name, provider_type, tool_name, tool_configurations } = inputs
  const isBuiltIn = provider_type === CollectionType.builtIn
  const [currCollection, setCurrCollection] = useState<Collection | null | undefined>(null)
  const fetchCurrCollection = useCallback(async () => {
    if (!provider_id)
      return
    const res = await fetchCollectionList()
    const currCollection = res.find(item => item.id === provider_id)
    setCurrCollection(currCollection)
  }, [provider_id])

  useEffect(() => {
    if (!provider_id || !isBuiltIn)
      return

    fetchCurrCollection()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider_id])

  // Auth
  const needAuth = !!currCollection?.allow_delete
  const isAuthed = !!currCollection?.is_team_authorization
  const isShowAuthBtn = isBuiltIn && needAuth && !isAuthed
  const [showSetAuth, {
    setTrue: showSetAuthModal,
    setFalse: hideSetAuthModal,
  }] = useBoolean(false)

  const handleSaveAuth = useCallback(async (value: any) => {
    await updateBuiltInToolCredential(currCollection?.name as string, value)

    Toast.notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    await fetchCurrCollection()
    hideSetAuthModal()
  }, [currCollection?.name, fetchCurrCollection, hideSetAuthModal, t])

  const [currTool, setCurrTool] = useState<Tool | null>(null)
  const formSchemas = currTool ? toolParametersToFormSchemas(currTool.parameters) : []
  const toolInputVarSchema = formSchemas.filter((item: any) => item.form === 'llm')
  // use setting
  const toolSettingSchema = formSchemas.filter((item: any) => item.form !== 'llm')
  const toolSettingValue = (() => {
    return addDefaultValue(tool_configurations, toolSettingSchema)
  })()
  const setToolSettingValue = useCallback((value: Record<string, any>) => {
    setInputs({
      ...inputs,
      tool_configurations: value,
    })
  }, [inputs, setInputs])

  useEffect(() => {
    if (!currTool)
      return
    const inputsWithDefaultValue = produce(inputs, (draft) => {
      draft.tool_configurations = addDefaultValue(tool_configurations, toolSettingSchema)
      draft.tool_parameters = toolInputVarSchema.map((item: any) => {
        return {
          variable: item.variable,
          variable_type: VarType.static,
          value: '',
        }
      })
    })
    setInputs(inputsWithDefaultValue)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currTool])

  // setting when call
  const setInputVar = useCallback((value: ToolVarInput[]) => {
    setInputs({
      ...inputs,
      tool_parameters: value,
    })
  }, [inputs, setInputs])

  // TODO: dynamic setting as the current var type
  const filterVar = useCallback((varPayload: Var) => {
    return varPayload.type !== VarVarType.arrayFile
  }, [])

  const isLoading = currTool && (isBuiltIn ? !currCollection : false)

  useEffect(() => {
    (async () => {
      let list: Tool[] = []
      if (toolsMap[provider_id]?.length) {
        list = toolsMap[provider_id]
      }
      else {
        list = isBuiltIn ? await fetchBuiltInToolList(provider_name || provider_id) : await fetchCustomToolList(provider_name)

        setToolsMap(produce(toolsMap, (draft) => {
          draft[provider_id] = list
        }))
      }
      const currTool = list.find(tool => tool.name === tool_name)
      if (currTool)
        setCurrTool(currTool)
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider_name])

  // single run
  const {
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    setRunInputData,
    handleRun,
    handleStop,
    runResult,
  } = useOneStepRun<ToolNodeType>({
    id,
    data: inputs,
    defaultRunInputData: {},
  })

  const [inputVarValues, doSetInputVarValues] = useState<Record<string, any>>({})
  const setInputVarValues = (value: Record<string, any>) => {
    doSetInputVarValues(value)
    setRunInputData(value)
  }

  const singleRunForms = (() => {
    const formInputs: InputVar[] = []
    toolInputVarSchema.forEach((item: any) => {
      // const targetItem = toolInputs.find(input => input.variable === item.variable)
      // TODO: support selector
      // if (targetItem?.variable_type === VarType.selector) {
      formInputs.push({
        label: item.label[language] || item.label.en_US,
        variable: item.variable,
        type: InputVarType.textInput, // TODO: to form input
        required: item.required,
      })
      // }
    })
    const forms: FormProps[] = [{
      inputs: formInputs,
      values: inputVarValues,
      onChange: setInputVarValues,
    }]
    return forms
  })()

  return {
    inputs,
    currTool,
    toolSettingSchema,
    toolSettingValue,
    setToolSettingValue,
    toolInputVarSchema,
    setInputVar,
    filterVar,
    currCollection,
    isShowAuthBtn,
    showSetAuth,
    showSetAuthModal,
    hideSetAuthModal,
    handleSaveAuth,
    isLoading,
    isShowSingleRun,
    hideSingleRun,
    inputVarValues,
    setInputVarValues,
    singleRunForms,
    runningStatus,
    handleRun,
    handleStop,
    runResult,
  }
}

export default useConfig
