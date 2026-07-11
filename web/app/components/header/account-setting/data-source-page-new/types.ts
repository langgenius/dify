import type {
  FormSchema,
  TypeWithI18N,
} from '@/app/components/base/form/types'
import type { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'

export type DataSourceCredential = {
  credential: Record<string, any>
  type: CredentialTypeEnum
  name: string
  id: string
  is_default: boolean
  avatar_url: string
  // Sharing scope: 'only_me' | 'all_team_members' | 'partial_members'
  visibility?: string
  // Creator account id (null for legacy credentials)
  user_id?: string | null
  // Whether the current user may change this credential's visibility
  is_editable?: boolean
  // Account ids granted access when visibility is 'partial_members'
  partial_member_list?: string[]
}
export type DataSourceAuth = {
  author: string
  provider: string
  plugin_id: string
  plugin_unique_identifier: string
  icon: string
  name: string
  label: TypeWithI18N
  description: TypeWithI18N
  credential_schema?: FormSchema[]
  oauth_schema?: {
    client_schema?: FormSchema[]
    credentials_schema?: FormSchema[]
    is_oauth_custom_client_enabled?: boolean
    is_system_oauth_params_exists?: boolean
    oauth_custom_client_params?: Record<string, any>
    redirect_uri?: string
  }
  credentials_list: DataSourceCredential[]
}
