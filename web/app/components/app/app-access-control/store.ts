import type { StoreApi } from 'zustand'
import type { AccessControlAccount, AccessControlGroup, AccessMode } from '@/models/access-control'
import type { App } from '@/types/app'
import { createContext, use } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

export type AccessControlDraft = {
  appId?: App['id']
  currentMenu: AccessMode
  specificGroups?: AccessControlGroup[]
  specificMembers?: AccessControlAccount[]
  selectedGroupsForBreadcrumb?: AccessControlGroup[]
}

export type AccessControlStore = {
  appId: App['id']
  specificGroups: AccessControlGroup[]
  setSpecificGroups: (specificGroups: AccessControlGroup[]) => void
  specificMembers: AccessControlAccount[]
  setSpecificMembers: (specificMembers: AccessControlAccount[]) => void
  currentMenu: AccessMode
  setCurrentMenu: (currentMenu: AccessMode) => void
  selectedGroupsForBreadcrumb: AccessControlGroup[]
  setSelectedGroupsForBreadcrumb: (selectedGroupsForBreadcrumb: AccessControlGroup[]) => void
}

export type AccessControlStoreApi = StoreApi<AccessControlStore>

export function createAccessControlStore(initialDraft: AccessControlDraft) {
  return createStore<AccessControlStore>(set => ({
    appId: initialDraft.appId ?? '',
    specificGroups: initialDraft.specificGroups ?? [],
    setSpecificGroups: specificGroups => set({ specificGroups }),
    specificMembers: initialDraft.specificMembers ?? [],
    setSpecificMembers: specificMembers => set({ specificMembers }),
    currentMenu: initialDraft.currentMenu,
    setCurrentMenu: currentMenu => set({ currentMenu }),
    selectedGroupsForBreadcrumb: initialDraft.selectedGroupsForBreadcrumb ?? [],
    setSelectedGroupsForBreadcrumb: selectedGroupsForBreadcrumb => set({ selectedGroupsForBreadcrumb }),
  }))
}

export const AccessControlStoreContext = createContext<AccessControlStoreApi | undefined>(undefined)

export function useAccessControlStore<T>(selector: (state: AccessControlStore) => T) {
  const store = use(AccessControlStoreContext)
  if (!store)
    throw new Error('useAccessControlStore must be used inside AccessControlDraftProvider')

  return useStore(store, selector)
}
