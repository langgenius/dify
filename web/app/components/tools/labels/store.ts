import type { Label } from './constant'
import { create } from 'zustand'

type State = {
  labelList: Label[]
}

type Action = {
  setLabelList: (labelList?: Label[]) => void
}

export const useStore = create<State & Action>(set => ({
  labelList: [],
  setLabelList: labelList => set(() => ({ labelList })),
}))
