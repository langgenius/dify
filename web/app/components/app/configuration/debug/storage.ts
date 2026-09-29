import type { DebugWithSingleOrMultipleModelConfigs } from './types'
import { createLocalStorageState } from 'foxact/create-local-storage-state'

const deserializeDebugModelConfigs = (value: string): DebugWithSingleOrMultipleModelConfigs => {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object'
      ? (parsed as DebugWithSingleOrMultipleModelConfigs)
      : {}
  } catch {
    return {}
  }
}

const [useDebugModelConfigsStorage] =
  createLocalStorageState<DebugWithSingleOrMultipleModelConfigs>(
    'app-debug-with-single-or-multiple-models',
    {},
    {
      serializer: (value) => JSON.stringify(value),
      deserializer: deserializeDebugModelConfigs,
    },
  )

export { useDebugModelConfigsStorage }
