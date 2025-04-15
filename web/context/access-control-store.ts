import { create } from 'zustand'
import type { AccessControlAccount, AccessControlGroup } from '@/models/access-control'
import { AccessMode } from '@/models/access-control'
import type { App } from '@/types/app'

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
  }
})

export default useAccessControlStore
