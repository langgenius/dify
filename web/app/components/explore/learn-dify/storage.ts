'use client'

import { createLocalStorageState } from 'foxact/create-local-storage-state'

export const LEARN_DIFY_HIDDEN_STORAGE_KEY = 'explore-learn-dify-hidden'

const [
  _useLearnDifyHidden,
  useLearnDifyHiddenValue,
  useSetLearnDifyHidden,
] = createLocalStorageState<boolean>(LEARN_DIFY_HIDDEN_STORAGE_KEY, false)

export {
  useLearnDifyHiddenValue,
  useSetLearnDifyHidden,
}
