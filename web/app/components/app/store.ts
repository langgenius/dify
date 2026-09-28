import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import { create } from 'zustand'

type State = {
  appDetail?: AppDetailWithSite
}

type Action = {
  setAppDetail: (appDetail?: AppDetailWithSite) => void
}

export const useStore = create<State & Action>((set) => ({
  appDetail: undefined,
  setAppDetail: (appDetail) => set(() => ({ appDetail })),
}))
