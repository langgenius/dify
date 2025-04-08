import { create } from 'zustand'
export enum AccessControlType {
  PUBLIC = 'PUBLIC',
  SPECIFIC_GROUPS_MEMBERS = 'SPECIFIC_GROUPS_MEMBERS',
  ORGANIZATION = 'ORGANIZATION',
}

type AccessControlStore = {
  specificGroups: []
  setSpecificGroups: (specificGroups: []) => void
  specificMembers: []
  setSpecificMembers: (specificMembers: []) => void
  currentMenu: AccessControlType
  setCurrentMenu: (currentMenu: AccessControlType) => void
}

const useAccessControlStore = create<AccessControlStore>((set) => {
  return {
    specificGroups: [],
    setSpecificGroups: specificGroups => set({ specificGroups }),
    specificMembers: [],
    setSpecificMembers: specificMembers => set({ specificMembers }),
    currentMenu: AccessControlType.SPECIFIC_GROUPS_MEMBERS,
    setCurrentMenu: currentMenu => set({ currentMenu }),
  }
})

export default useAccessControlStore
