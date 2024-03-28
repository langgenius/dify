import { create } from 'zustand'
import type { Tag } from './constant'

type State = {
  tagList: Tag[]
}

type Action = {
  setTagList: (tagList?: Tag[]) => void
}

export const useStore = create<State & Action>(set => ({
  tagList: [],
  setTagList: tagList => set(() => ({ tagList })),
}))
