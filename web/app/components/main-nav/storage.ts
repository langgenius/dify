import { createLocalStorageState } from 'foxact/create-local-storage-state'

export type MainNavMode = 'expand' | 'collapse'

export const MAIN_NAV_STORAGE_KEY = 'main-nav-collapse-or-expand'

const [useMainNavMode, _useMainNavModeValue, useSetMainNavMode] =
  createLocalStorageState<MainNavMode>(MAIN_NAV_STORAGE_KEY, 'expand', { raw: true })

export { useMainNavMode, useSetMainNavMode }
