import type { AccessControlAccount, AccessControlGroup } from '@/models/access-control'
import type { App } from '@/types/app'
import { create } from 'zustand'
import { AccessMode } from '@/models/access-control'

type AccessControlStore = {
  appId: App['id']
  setAppId: (appId: App['id']) => void
  specificGroups: AccessControlGroup[]
  setSpecificGroups: (specificGroups: AccessControlGroup[]) => void
  specificMembers: AccessControlAccount[]
  setSpecificMembers: (specificMembers: AccessControlAccount[]) => void
  currentMenu: AccessMode
  setCurrentMenu: (currentMenu: AccessMode) => void
  selectedGroupsForBreadcrumb: AccessControlGroup[]
  setSelectedGroupsForBreadcrumb: (selectedGroupsForBreadcrumb: AccessControlGroup[]) => void
  initializeAccessControlDraft: (draft: {
    appId?: App['id']
    currentMenu: AccessMode
    specificGroups?: AccessControlGroup[]
    specificMembers?: AccessControlAccount[]
    selectedGroupsForBreadcrumb?: AccessControlGroup[]
  }) => void
}

const useAccessControlStore = create<AccessControlStore>((set) => {
  return {
    appId: '',
    setAppId: appId => set({ appId }),
    specificGroups: [],
    setSpecificGroups: specificGroups => set({ specificGroups }),
    specificMembers: [],
    setSpecificMembers: specificMembers => set({ specificMembers }),
    currentMenu: AccessMode.SPECIFIC_GROUPS_MEMBERS,
    setCurrentMenu: currentMenu => set({ currentMenu }),
    selectedGroupsForBreadcrumb: [],
    setSelectedGroupsForBreadcrumb: selectedGroupsForBreadcrumb => set({ selectedGroupsForBreadcrumb }),
    initializeAccessControlDraft: draft => set(state => ({
      appId: draft.appId ?? state.appId,
      currentMenu: draft.currentMenu,
      specificGroups: draft.specificGroups ?? state.specificGroups,
      specificMembers: draft.specificMembers ?? state.specificMembers,
      selectedGroupsForBreadcrumb: draft.selectedGroupsForBreadcrumb ?? state.selectedGroupsForBreadcrumb,
    })),
  }
})

export default useAccessControlStore
