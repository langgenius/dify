import { create } from 'zustand'
import type { App } from '@/types/app'

type State = {
  appDetail?: App
  appSidebarExpand: string
}

type Action = {
  setAppDetail: (appDetail?: App) => void
  setAppSiderbarExpand: (state: string) => void
}

export const useStore = create<State & Action>(set => ({
  appDetail: undefined,
  setAppDetail: appDetail => set(() => ({ appDetail })),
  appSidebarExpand: '',
  setAppSiderbarExpand: appSidebarExpand => set(() => ({ appSidebarExpand })),
}))
