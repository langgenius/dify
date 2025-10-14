import type { StateCreator } from 'zustand'

export type CommonShape = {
  currentNodeIdRef: React.RefObject<string>
  currentCredentialId: string
  setCurrentCredentialId: (credentialId: string) => void
  currentCredentialIdRef: React.RefObject<string>
}

export const createCommonSlice: StateCreator<CommonShape> = (set) => {
  return ({
    currentNodeIdRef: { current: '' },
    currentCredentialId: '',
    setCurrentCredentialId: (credentialId: string) => {
      set({ currentCredentialId: credentialId })
    },
    currentCredentialIdRef: { current: '' },
  })
}
