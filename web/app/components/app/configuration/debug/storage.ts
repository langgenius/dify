import type { DebugWithSingleOrMultipleModelConfigs } from './types'
import { createLocalStorageState } from 'foxact/create-local-storage-state'

const DEBUG_WITH_SINGLE_OR_MULTIPLE_MODEL_STORAGE_KEY = 'app-debug-with-single-or-multiple-models'

const debugWithSingleOrMultipleModelStorageOptions = {
  serializer: JSON.stringify,
  deserializer: (value: string) => {
    try {
      return (JSON.parse(value) as DebugWithSingleOrMultipleModelConfigs) || {}
    } catch (e) {
      console.error(e)
      return {}
    }
  },
}

const [
  useDebugWithSingleOrMultipleModelConfigs,
  _useDebugWithSingleOrMultipleModelConfigsValue,
  _useSetDebugWithSingleOrMultipleModelConfigs,
] = createLocalStorageState<DebugWithSingleOrMultipleModelConfigs>(
  DEBUG_WITH_SINGLE_OR_MULTIPLE_MODEL_STORAGE_KEY,
  {},
  debugWithSingleOrMultipleModelStorageOptions,
)

export { useDebugWithSingleOrMultipleModelConfigs }
