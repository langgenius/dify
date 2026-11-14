import type { Credential, PluginPayload } from '../types'
import { AuthCategory, CredentialTypeEnum } from '../types'

export const pluginPayload: PluginPayload = {
  category: AuthCategory.tool,
  provider: 'test-provider',
}

export const createCredential = (overrides: Partial<Credential> = {}): Credential => ({
  id: 'credential-1',
  name: 'Team API key',
  provider: pluginPayload.provider,
  credential_type: CredentialTypeEnum.API_KEY,
  is_default: true,
  credentials: { api_key: 'test-key' },
  ...overrides,
})

export const credentialInfo = (credentials: Credential[] = [createCredential()]) => ({
  credentials,
  supported_credential_types: [CredentialTypeEnum.API_KEY],
  allow_custom_token: true,
  is_oauth_custom_client_enabled: false,
})
