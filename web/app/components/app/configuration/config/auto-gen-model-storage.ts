import type { Model } from '@/types/app'
import { createLocalStorageState } from 'foxact/create-local-storage-state'

const [
  useAutoGenModel,
  _useAutoGenModelValue,
  _useSetAutoGenModel,
] = createLocalStorageState<Model>('auto-gen-model')

export {
  useAutoGenModel,
}
