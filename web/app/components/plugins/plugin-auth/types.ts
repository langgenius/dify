import type { CollectionType } from '../../tools/types'

export type { AddApiKeyButtonProps } from './authorize/add-api-key-button'
export type { AddOAuthButtonProps } from './authorize/add-oauth-button'

export enum AuthCategory {
  tool = 'tool',
  datasource = 'datasource',
  model = 'model',
}

export type PluginPayload = {
  category: AuthCategory
  provider: string
  providerType: CollectionType | string
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
  from_enterprise?: boolean
  not_allowed_to_use?: boolean
}
