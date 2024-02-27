import { useCallback, useState } from 'react'
import useVarList from '../_base/hooks/use-var-list'
import type { HttpNodeType, MethodEnum } from './types'
import useKeyValueList from './hooks/use-key-value-list'
const useConfig = (initInputs: HttpNodeType) => {
  const [inputs, setInputs] = useState<HttpNodeType>(initInputs)

  const { handleVarListChange, handleAddVariable } = useVarList<HttpNodeType>({
    inputs,
    setInputs,
  })

  const handleMethodChange = useCallback((method: MethodEnum) => {
    setInputs(prev => ({
      ...prev,
      method,
    }))
  }, [])

  const handleUrlChange = useCallback((url: string) => {
    setInputs(prev => ({
      ...prev,
      url,
    }))
  }, [])

  const { list: headers, setList: setHeaders, addItem: addHeader } = useKeyValueList(inputs.headers)

  return {
    inputs,
    handleVarListChange,
    handleAddVariable,
    handleMethodChange,
    handleUrlChange,
    headers,
    setHeaders,
    addHeader,
  }
}

export default useConfig
