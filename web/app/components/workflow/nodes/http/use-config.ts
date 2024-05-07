import { useCallback, useEffect } from 'react'
import produce from 'immer'
import { useBoolean } from 'ahooks'
import useVarList from '../_base/hooks/use-var-list'
import { VarType } from '../../types'
import type { Var } from '../../types'
import { useStore } from '../../store'
import type { Authorization, Body, HttpNodeType, Method, Timeout } from './types'
import useKeyValueList from './hooks/use-key-value-list'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import useOneStepRun from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'

const useConfig = (id: string, payload: HttpNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()

  const defaultConfig = useStore(s => s.nodesDefaultConfigs)[payload.type]

  const { inputs, setInputs } = useNodeCrud<HttpNodeType>(id, payload)

  const { handleVarListChange, handleAddVariable } = useVarList<HttpNodeType>({
    inputs,
    setInputs,
  })

  useEffect(() => {
    const isReady = defaultConfig && Object.keys(defaultConfig).length > 0
    if (isReady) {
      setInputs({
        ...defaultConfig,
        ...inputs,
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultConfig])

  const handleMethodChange = useCallback((method: Method) => {
    const newInputs = produce(inputs, (draft: HttpNodeType) => {
      draft.method = method
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleUrlChange = useCallback((url: string) => {
    const newInputs = produce(inputs, (draft: HttpNodeType) => {
      draft.url = url
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleFieldChange = useCallback((field: string) => {
    return (value: string) => {
      const newInputs = produce(inputs, (draft: HttpNodeType) => {
        (draft as any)[field] = value
      })
      setInputs(newInputs)
    }
  }, [inputs, setInputs])

  const {
    list: headers,
    setList: setHeaders,
    addItem: addHeader,
    isKeyValueEdit: isHeaderKeyValueEdit,
    toggleIsKeyValueEdit: toggleIsHeaderKeyValueEdit,
  } = useKeyValueList(inputs.headers, handleFieldChange('headers'))

  const {
    list: params,
    setList: setParams,
    addItem: addParam,
    isKeyValueEdit: isParamKeyValueEdit,
    toggleIsKeyValueEdit: toggleIsParamKeyValueEdit,
  } = useKeyValueList(inputs.params, handleFieldChange('params'))

  const setBody = useCallback((data: Body) => {
    const newInputs = produce(inputs, (draft: HttpNodeType) => {
      draft.body = data
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  // authorization
  const [isShowAuthorization, {
    setTrue: showAuthorization,
    setFalse: hideAuthorization,
  }] = useBoolean(false)

  const setAuthorization = useCallback((authorization: Authorization) => {
    const newInputs = produce(inputs, (draft: HttpNodeType) => {
      draft.authorization = authorization
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const setTimeout = useCallback((timeout: Timeout) => {
    const newInputs = produce(inputs, (draft: HttpNodeType) => {
      draft.timeout = timeout
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const filterVar = useCallback((varPayload: Var) => {
    return [VarType.string, VarType.number].includes(varPayload.type)
  }, [])

  // single run
  const {
    isShowSingleRun,
    hideSingleRun,
    getInputVars,
    runningStatus,
    handleRun,
    handleStop,
    runInputData,
    setRunInputData,
    runResult,
  } = useOneStepRun<HttpNodeType>({
    id,
    data: inputs,
    defaultRunInputData: {},
  })

  const varInputs = getInputVars([
    inputs.url,
    inputs.headers,
    inputs.params,
    inputs.body.data,
  ])

  const inputVarValues = (() => {
    const vars: Record<string, any> = {}
    Object.keys(runInputData)
      .forEach((key) => {
        vars[key] = runInputData[key]
      })
    return vars
  })()

  const setInputVarValues = useCallback((newPayload: Record<string, any>) => {
    setRunInputData(newPayload)
  }, [setRunInputData])

  return {
    readOnly,
    inputs,
    handleVarListChange,
    handleAddVariable,
    filterVar,
    handleMethodChange,
    handleUrlChange,
    // headers
    headers,
    setHeaders,
    addHeader,
    isHeaderKeyValueEdit,
    toggleIsHeaderKeyValueEdit,
    // params
    params,
    setParams,
    addParam,
    isParamKeyValueEdit,
    toggleIsParamKeyValueEdit,
    // body
    setBody,
    // authorization
    isShowAuthorization,
    showAuthorization,
    hideAuthorization,
    setAuthorization,
    setTimeout,
    // single run
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    handleRun,
    handleStop,
    varInputs,
    inputVarValues,
    setInputVarValues,
    runResult,
  }
}

export default useConfig
