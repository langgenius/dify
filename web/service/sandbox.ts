import { del, get, post } from './base'

export type SandboxProvider = {
  provider_type: string
  is_active: boolean
  config?: Record<string, any>
  config_schema?: Array<{
    name: string
    type: string
  }>
}

export const listSandboxProviders = (): Promise<SandboxProvider[]> => {
  return get<SandboxProvider[]>('workspaces/current/sandbox-providers')
}

export const saveSandboxProviderConfig = (
  providerType: string,
  config: Record<string, any>,
  activate = false,
): Promise<{ result: string }> => {
  return post<{ result: string }>(`workspaces/current/sandbox-provider/${providerType}/config`, {
    body: { config, activate },
  })
}

export const activateSandboxProvider = (
  providerType: string,
  type = 'user',
): Promise<{ result: string }> => {
  return post<{ result: string }>(`workspaces/current/sandbox-provider/${providerType}/activate`, {
    body: { type },
  })
}

export const deleteSandboxProviderConfig = (
  providerType: string,
): Promise<{ result: string }> => {
  return del<{ result: string }>(`workspaces/current/sandbox-provider/${providerType}/config`)
}
