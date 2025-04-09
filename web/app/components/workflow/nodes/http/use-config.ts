import { useCallback, useEffect, useMemo, useState } from 'react'
import produce from 'immer'
import { useBoolean } from 'ahooks'
import useVarList from '../_base/hooks/use-var-list'
import { VarType } from '../../types'
import type { Var } from '../../types'
import { useStore } from '../../store'
import { type Authorization, type Body, BodyType, type HttpNodeType, type Method, type Timeout } from './types'
import useKeyValueList from './hooks/use-key-value-list'
import { transformToBodyPayload } from './utils'
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

  const [isDataReady, setIsDataReady] = useState(false)

  useEffect(() => {
    const isReady = defaultConfig && Object.keys(defaultConfig).length > 0
    if (isReady) {
      const newInputs = {
        ...defaultConfig,
        ...inputs,
      }
      const bodyData = newInputs.body.data
      if (typeof bodyData === 'string') {
        newInputs.body = {
          ...newInputs.body,
          data: transformToBodyPayload(bodyData, [BodyType.formData, BodyType.xWwwFormUrlencoded].includes(newInputs.body.type)),
        }
      }

      setInputs(newInputs)
      setIsDataReady(true)
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
    return [VarType.string, VarType.number, VarType.secret].includes(varPayload.type)
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

  const fileVarInputs = useMemo(() => {
    if (!Array.isArray(inputs.body.data))
      return ''

    const res = inputs.body.data
      .filter(item => item.file?.length)
      .map(item => item.file ? `{{#${item.file.join('.')}#}}` : '')
      .join(' ')
    return res
  }, [inputs.body.data])

  const varInputs = getInputVars([
    inputs.url,
    inputs.headers,
    inputs.params,
    typeof inputs.body.data === 'string' ? inputs.body.data : inputs.body.data.map(item => item.value).join(''),
    fileVarInputs,
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

  // curl import panel
  const [isShowCurlPanel, {
    setTrue: showCurlPanel,
    setFalse: hideCurlPanel,
  }] = useBoolean(false)

  const handleCurlImport = useCallback((newNode: HttpNodeType) => {
    const newInputs = produce(inputs, (draft: HttpNodeType) => {
      draft.method = newNode.method
      draft.url = newNode.url
      draft.headers = newNode.headers
      draft.params = newNode.params
      draft.body = newNode.body
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  return {
    readOnly,
    isDataReady,
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
    // curl import
    isShowCurlPanel,
    showCurlPanel,
    hideCurlPanel,
    handleCurlImport,
  }
}

export default useConfig
