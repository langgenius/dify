import {
  useCallback,
  useRef,
  useState,
} from 'react'
import type {
  DebugWithSingleOrMultipleModelConfigs,
  ModelAndParameter,
} from './types'

export const useDebugWithSingleOrMultipleModel = (appId: string) => {
  const localeDebugWithSingleOrMultipleModelConfigs = localStorage.getItem('app-debug-with-single-or-multiple-models')

  const debugWithSingleOrMultipleModelConfigs = useRef<DebugWithSingleOrMultipleModelConfigs>({})

  if (localeDebugWithSingleOrMultipleModelConfigs) {
    try {
      debugWithSingleOrMultipleModelConfigs.current = JSON.parse(localeDebugWithSingleOrMultipleModelConfigs) || {}
    }
    catch (e) {
      console.error(e)
    }
  }

  const [
    debugWithMultipleModel,
    setDebugWithMultipleModel,
  ] = useState(debugWithSingleOrMultipleModelConfigs.current[appId]?.multiple || false)

  const [
    multipleModelConfigs,
    setMultipleModelConfigs,
  ] = useState(debugWithSingleOrMultipleModelConfigs.current[appId]?.configs || [])

  const handleMultipleModelConfigsChange = useCallback((
    multiple: boolean,
    modelConfigs: ModelAndParameter[],
  ) => {
    const value = {
      multiple,
      configs: modelConfigs,
    }
    debugWithSingleOrMultipleModelConfigs.current[appId] = value
    localStorage.setItem('app-debug-with-single-or-multiple-models', JSON.stringify(debugWithSingleOrMultipleModelConfigs.current))
    setDebugWithMultipleModel(value.multiple)
    setMultipleModelConfigs(value.configs)
  }, [appId])

  return {
    debugWithMultipleModel,
    multipleModelConfigs,
    handleMultipleModelConfigsChange,
  }
}
