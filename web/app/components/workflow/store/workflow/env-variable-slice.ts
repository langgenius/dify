import type { StateCreator } from 'zustand'
import type {
  EnvironmentVariable,
} from '@/app/components/workflow/types'

export type EnvVariableSliceShape = {
  showEnvPanel: boolean
  setShowEnvPanel: (showEnvPanel: boolean) => void
  environmentVariables: EnvironmentVariable[]
  setEnvironmentVariables: (environmentVariables: EnvironmentVariable[]) => void
  envSecrets: Record<string, string>
  setEnvSecrets: (envSecrets: Record<string, string>) => void
  restoredSecretsInfo: Record<string, { from_version: string }>
  setRestoredSecretsInfo: (restoredSecretsInfo: Record<string, { from_version: string }>) => void
  updateRestoredSecretsInfo: (key: string, value: { from_version: string }) => void
}

export const createEnvVariableSlice: StateCreator<EnvVariableSliceShape> = (set, get) => ({
  showEnvPanel: false,
  setShowEnvPanel: showEnvPanel => set(() => ({ showEnvPanel })),
  environmentVariables: [],
  setEnvironmentVariables: environmentVariables => set(() => ({ environmentVariables })),
  envSecrets: {},
  setEnvSecrets: envSecrets => set(() => ({ envSecrets })),
  restoredSecretsInfo: {},
  setRestoredSecretsInfo: restoredSecretsInfo => set(() => ({ restoredSecretsInfo })),
  updateRestoredSecretsInfo: (key, value) => {
    const { restoredSecretsInfo } = get()
    const newRestoredSecretsInfo = { ...restoredSecretsInfo, [key]: value }
    set(() => ({ restoredSecretsInfo: newRestoredSecretsInfo }))
  },
})
