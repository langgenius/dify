import type { StateCreator } from 'zustand'
import type { EnvironmentVariable } from '@/app/components/workflow/types'

export type EnvVariableSliceShape = {
  showEnvPanel: boolean
  setShowEnvPanel: (showEnvPanel: boolean) => void
  environmentVariables: EnvironmentVariable[]
  setEnvironmentVariables: (environmentVariables: EnvironmentVariable[]) => void
  envSecrets: Record<string, string>
  setEnvSecrets: (envSecrets: Record<string, string>) => void
}

export const createEnvVariableSlice: StateCreator<EnvVariableSliceShape> = (set) => {
  const hideAllPanel = {
    showDebugAndPreviewPanel: false,
    showEnvPanel: false,
    showChatVariablePanel: false,
    showGlobalVariablePanel: false,
  }
  return ({
    showEnvPanel: false,
    setShowEnvPanel: showEnvPanel => set(() => {
      if (showEnvPanel)
        return { ...hideAllPanel, showEnvPanel: true }
      else
        return { showEnvPanel: false }
    }),
    environmentVariables: [],
    setEnvironmentVariables: environmentVariables => set(() => ({ environmentVariables })),
    envSecrets: {},
    setEnvSecrets: envSecrets => set(() => ({ envSecrets })),
  })
}
