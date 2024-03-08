import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import type { ToolNodeType, ToolVarInput } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { CollectionType } from '@/app/components/tools/types'
import type { Collection, Tool } from '@/app/components/tools/types'
import { fetchBuiltInToolList, fetchCollectionList, fetchCustomToolList } from '@/service/tools'
import { addDefaultValue, toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import Toast from '@/app/components/base/toast'

const useConfig = (id: string, payload: ToolNodeType) => {
  const { t } = useTranslation()

  const { inputs, setInputs } = useNodeCrud<ToolNodeType>(id, payload)
  const { provider_id, provider_name, provider_type, tool_name, tool_parameters } = inputs
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
    // await updateBuiltInToolCredential(currCollection?.name, value)

    Toast.notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    await fetchCurrCollection()
    hideSetAuthModal()
  }, [currCollection])

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
  const toolInputVarSchema = formSchemas.filter((item: any) => item.form === 'llm')
  const setInputVar = useCallback((value: ToolVarInput[]) => {
    setInputs({
      ...inputs,
      tool_inputs: value,
    })
  }, [inputs, setInputs])

  const isLoading = currTool && (isBuiltIn ? !currCollection : false)

  useEffect(() => {
    (async () => {
      const list = isBuiltIn ? await fetchBuiltInToolList(provider_name || provider_id) : await fetchCustomToolList(provider_name)
      const currTool = list.find(tool => tool.name === tool_name)
      if (currTool)
        setCurrTool(currTool)
    })()
  }, [provider_name])

  return {
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
  }
}

export default useConfig
