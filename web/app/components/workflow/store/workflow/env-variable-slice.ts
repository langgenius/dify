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

export const createEnvVariableSlice: StateCreator<EnvVariableSliceShape> = set => ({
  showEnvPanel: false,
  setShowEnvPanel: showEnvPanel => set(() => ({ showEnvPanel })),
  environmentVariables: [],
  setEnvironmentVariables: environmentVariables => set(() => ({ environmentVariables })),
  envSecrets: {},
  setEnvSecrets: envSecrets => set(() => ({ envSecrets })),
})
