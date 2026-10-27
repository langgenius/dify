import type { CollectionProviderType } from '../../tools/types'
import type { PluginDetail } from '../types'

export type { AddApiKeyButtonProps } from './authorize/add-api-key-button'
export type { AddOAuthButtonProps } from './authorize/add-oauth-button'

export const AuthCategory = {
  tool: 'tool',
  datasource: 'datasource',
  model: 'model',
  trigger: 'trigger',
} as const

export type AuthCategory = (typeof AuthCategory)[keyof typeof AuthCategory]

export type PluginPayload = {
  category: AuthCategory
  provider: string
  providerType?: CollectionProviderType
  detail?: PluginDetail
}

export const CredentialTypeEnum = {
  OAUTH2: 'oauth2',
  API_KEY: 'api-key',
} as const

export type CredentialTypeEnum = (typeof CredentialTypeEnum)[keyof typeof CredentialTypeEnum]

export type Credential = {
  id: string
  name: string
  provider: string
  credential_type?: CredentialTypeEnum
  is_default: boolean
  credentials?: Record<string, unknown>
  isWorkspaceDefault?: boolean
  from_enterprise?: boolean
  not_allowed_to_use?: boolean
  visibility?: string
  created_by?: string
  partial_member_list?: string[]
  /**
   * True when the backend returned this credential only because the current node
   * still references it, but the visibility filter would normally hide it
   * (another member's `only_me` credential). The row renders the "切换后不可再选回"
   * hint and locks rename/edit/delete/set-default actions.
   */
  from_other_member?: boolean
}
