import type { Tag } from './constant'
import { create } from 'zustand'

type State = {
  tagList: Tag[]
  showTagManagementModal: boolean
}

type Action = {
  setTagList: (tagList?: Tag[]) => void
  setShowTagManagementModal: (showTagManagementModal: boolean) => void
}

export const useStore = create<State & Action>(set => ({
  tagList: [],
  setTagList: tagList => set(() => ({ tagList })),
  showTagManagementModal: false,
  setShowTagManagementModal: showTagManagementModal => set(() => ({ showTagManagementModal })),
}))
