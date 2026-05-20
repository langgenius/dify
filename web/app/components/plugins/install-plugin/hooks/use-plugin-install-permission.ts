import type { StoreApi } from 'zustand'
import { createContext, use } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

export type PluginInstallPermissionState = {
  canInstallPlugin: boolean
  currentDifyVersion?: string
}

type PluginInstallPermissionAction = {
  setPluginInstallPermission: (state: PluginInstallPermissionState) => void
}

export type PluginInstallPermissionStoreState = PluginInstallPermissionState & PluginInstallPermissionAction

export type PluginInstallPermissionStore = StoreApi<PluginInstallPermissionStoreState>

const defaultPluginInstallPermissionState: PluginInstallPermissionState = {
  canInstallPlugin: true,
}

export const createPluginInstallPermissionStore = (initProps?: Partial<PluginInstallPermissionState>) => {
  return createStore<PluginInstallPermissionStoreState>()(set => ({
    ...defaultPluginInstallPermissionState,
    ...initProps,
    setPluginInstallPermission: state => set(() => state),
  }))
}

export const PluginInstallPermissionContext = createContext<PluginInstallPermissionStore | null>(null)

export const usePluginInstallPermissionStore = <T>(selector: (state: PluginInstallPermissionStoreState) => T): T => {
  const store = use(PluginInstallPermissionContext)
  if (!store)
    throw new Error('Missing PluginInstallPermissionProvider in the tree')

  return useStore(store, selector)
}

const usePluginInstallPermission = () => {
  const canInstallPlugin = usePluginInstallPermissionStore(state => state.canInstallPlugin)
  const currentDifyVersion = usePluginInstallPermissionStore(state => state.currentDifyVersion)

  return {
    canInstallPlugin,
    currentDifyVersion,
  }
}

export default usePluginInstallPermission
