export enum AuthCategory {
  tool = 'tool',
  datasource = 'datasource',
  model = 'model',
}

export type PluginPayload = {
  category: AuthCategory
  provider: string
}

export enum CredentialTypeEnum {
  OAUTH2 = 'oauth2',
  API_KEY = 'api-key',
}

export type Credential = {
  id: string
  name: string
  provider: string
  credential_type?: CredentialTypeEnum
  is_default: boolean
  credentials?: Record<string, any>
  isWorkspaceDefault?: boolean
}
