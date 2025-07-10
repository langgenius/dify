import type { StateCreator } from 'zustand'

export type CommonShape = {
  currentNodeIdRef: React.MutableRefObject<string | undefined>
}

export const createCommonSlice: StateCreator<CommonShape> = () => {
  return ({
    currentNodeIdRef: { current: undefined },
  })
}
