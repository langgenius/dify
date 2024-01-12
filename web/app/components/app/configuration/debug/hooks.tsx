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

  const handleAddModel = useCallback(() => {
    const value = {
      multiple: true,
      configs: [
        ...debugWithSingleOrMultipleModelConfigs.current[appId].configs!,
        { model: '', provider: '', parameters: {} },
      ],
    }
    debugWithSingleOrMultipleModelConfigs.current[appId] = value
    localStorage.setItem('app-debug-with-single-or-multiple-models', JSON.stringify(debugWithSingleOrMultipleModelConfigs.current))
    setDebugWithMultipleModel(value.multiple)
    setMultipleModelConfigs(value.configs)
  }, [appId])
  // const handleRemoveModel = useCallback((index: number) => {
  //   setMultipleModelConfigs((prev) => {
  //     const newModelsConfig = prev.filter((_, i) => i !== index)
  //     debugWithSingleOrMultipleModelConfigs[appId].configs = newModelsConfig
  //     localStorage.setItem('app-debug-with-multiple-models', JSON.stringify(debugWithSingleOrMultipleModelConfigs))
  //     return newModelsConfig
  //   })
  // }, [appId])
  const handleDebugWithMultipleModel = useCallback((currentModelConfig?: ModelAndParameter) => {
    const value = {
      multiple: true,
      configs: currentModelConfig ? [currentModelConfig, { model: '', provider: '', parameters: {} }] : [],
    }
    debugWithSingleOrMultipleModelConfigs.current[appId] = value
    localStorage.setItem('app-debug-with-single-or-multiple-models', JSON.stringify(debugWithSingleOrMultipleModelConfigs.current))
    setDebugWithMultipleModel(value.multiple)
    setMultipleModelConfigs(value.configs)
  }, [appId])
  const handleDebugWithSingleModel = useCallback(() => {
    const value = {
      multiple: false,
      configs: [],
    }
    debugWithSingleOrMultipleModelConfigs.current[appId] = value
    localStorage.setItem('app-debug-with-single-or-multiple-models', JSON.stringify(debugWithSingleOrMultipleModelConfigs.current))
    setDebugWithMultipleModel(value.multiple)
    setMultipleModelConfigs(value.configs)
  }, [appId])

  return {
    debugWithMultipleModel,
    multipleModelConfigs,
    handleDebugWithMultipleModel,
    handleDebugWithSingleModel,
    handleAddModel,
    // handleRemoveModel,
  }
}
