import type { CreateSubGraphSlice, SubGraphSliceShape } from '../types'

const initialState: Omit<SubGraphSliceShape, 'setParentAvailableVars' | 'setParentAvailableNodes'> = {
  parentAvailableVars: [],
  parentAvailableNodes: [],
}

export const createSubGraphSlice: CreateSubGraphSlice = set => ({
  ...initialState,
  setParentAvailableVars: vars => set(() => ({ parentAvailableVars: vars })),
  setParentAvailableNodes: nodes => set(() => ({ parentAvailableNodes: nodes })),
})
