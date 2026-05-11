import type { Dependency } from '@/app/components/plugins/types'
import { create } from 'zustand'

type Shape = {
  dependencies: Dependency[]
  setDependencies: (dependencies: Dependency[]) => void
}
export const useStore = create<Shape>(set => ({
  dependencies: [],
  setDependencies: dependencies => set({ dependencies }),
}))
