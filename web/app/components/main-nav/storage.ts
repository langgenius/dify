import { createLocalStorageState } from 'foxact/create-local-storage-state'

type MainNavMode = 'expand' | 'collapse'

const [useMainNavMode, _useMainNavModeValue, _useSetMainNavMode] =
  createLocalStorageState<MainNavMode>('main-nav-collapse-or-expand', 'expand', { raw: true })

export { useMainNavMode }
