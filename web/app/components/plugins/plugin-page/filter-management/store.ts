import { create } from 'zustand'
import type { Category, Tag } from './constant'

type State = {
  tagList: Tag[]
  categoryList: Category[]
  showTagManagementModal: boolean
  showCategoryManagementModal: boolean
}

type Action = {
  setTagList: (tagList?: Tag[]) => void
  setCategoryList: (categoryList?: Category[]) => void
  setShowTagManagementModal: (showTagManagementModal: boolean) => void
  setShowCategoryManagementModal: (showCategoryManagementModal: boolean) => void
}

export const useStore = create<State & Action>(set => ({
  tagList: [],
  categoryList: [],
  setTagList: tagList => set(() => ({ tagList })),
  setCategoryList: categoryList => set(() => ({ categoryList })),
  showTagManagementModal: false,
  showCategoryManagementModal: false,
  setShowTagManagementModal: showTagManagementModal => set(() => ({ showTagManagementModal })),
  setShowCategoryManagementModal: showCategoryManagementModal => set(() => ({ showCategoryManagementModal })),
}))
