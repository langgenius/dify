import { create } from 'zustand'
import type { App } from '@/types/app'

type State = {
  appDetail?: App
}

type Action = {
  setAppDetail: (appDetail?: App) => void
}

export const useStore = create<State & Action>(set => ({
  appDetail: undefined,
  setAppDetail: appDetail => set(() => ({ appDetail })),
}))
