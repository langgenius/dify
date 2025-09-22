import { create } from 'zustand'
import type { Label } from './constant'

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
