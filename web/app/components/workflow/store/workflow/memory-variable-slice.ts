import type { StateCreator } from 'zustand'
import type { MemoryVariable } from '@/app/components/workflow/types'

export type MemoryVariableSliceShape = {
  memoryVariables: MemoryVariable[]
  setMemoryVariables: (memoryVariables: MemoryVariable[]) => void
}

export const createMemoryVariableSlice: StateCreator<MemoryVariableSliceShape> = (set) => {
  return ({
    memoryVariables: [],
    setMemoryVariables: memoryVariables => set(() => ({ memoryVariables })),
  })
}
