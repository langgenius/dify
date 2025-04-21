// stores/useUpdateFlagStore.ts
import { create } from 'zustand'

type UpdateFlagStore = {
  updateFlag: boolean
  toggleFlag: () => void
  setFlag: (value: boolean) => void
}

const useUpdateFlagStore = create<UpdateFlagStore>(set => ({
  updateFlag: false,
  toggleFlag: () => set(state => ({ updateFlag: !state.updateFlag })),
  setFlag: value => set({ updateFlag: value }),
}))

export default useUpdateFlagStore
