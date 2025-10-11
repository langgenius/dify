import { create } from 'zustand'
import type { Dependency } from '@/app/components/plugins/types'

type Shape = {
  dependencies: Dependency[]
  setDependencies: (dependencies: Dependency[]) => void
}
export const useStore = create<Shape>(set => ({
  dependencies: [],
  setDependencies: dependencies => set({ dependencies }),
}))
