import type { ToolNodeType } from './types'
import type {
  AppUserAuthDraft,
  AuthorizationTab,
} from '@/app/components/plugins/plugin-auth/app-user-auth/draft'
import { ToolCredentialSource } from './types'

export type ToolAuthorizationData = Pick<
  ToolNodeType,
  'credential_source' | 'credential_id' | 'end_user_auth' | 'reuse_node_id' | 'test_credential_id'
>

export const getToolAuthorizationTab = (data: Partial<ToolNodeType>): AuthorizationTab => {
  if (data.credential_source === ToolCredentialSource.EndUser) return 'app-user-auth'
  if (data.credential_source === ToolCredentialSource.ReuseNode) return 'reuse-from-node'
  return 'workspace-auth'
}

export const getAppUserAuthDraft = (data: Partial<ToolNodeType>): AppUserAuthDraft => ({
  oauthEnabled: data.end_user_auth?.allowed_credential_types?.includes('oauth2') ?? false,
  apiKeyEnabled: data.end_user_auth?.allowed_credential_types?.includes('api-key') ?? false,
  description: data.end_user_auth?.purpose ?? '',
  client: data.end_user_auth?.oauth_client_type
    ? { type: data.end_user_auth.oauth_client_type }
    : undefined,
  testCredentialId: data.test_credential_id ?? undefined,
})

export const getAppUserAuthUpdate = (draft: AppUserAuthDraft): ToolAuthorizationData => ({
  credential_source: ToolCredentialSource.EndUser,
  credential_id: undefined,
  reuse_node_id: undefined,
  end_user_auth: {
    allowed_credential_types: [
      ...(draft.apiKeyEnabled ? ['api-key' as const] : []),
      ...(draft.oauthEnabled ? ['oauth2' as const] : []),
    ],
    purpose: draft.description,
    oauth_client_type: draft.oauthEnabled ? draft.client?.type : undefined,
  },
  test_credential_id: draft.testCredentialId || undefined,
})

export const getWorkspaceAuthUpdate = (credentialId?: string): ToolAuthorizationData => ({
  credential_source: ToolCredentialSource.Workspace,
  credential_id: credentialId || undefined,
  end_user_auth: undefined,
  reuse_node_id: undefined,
  test_credential_id: undefined,
})

export const getReuseAuthUpdate = (sourceId?: string): ToolAuthorizationData => ({
  credential_source: ToolCredentialSource.ReuseNode,
  credential_id: undefined,
  end_user_auth: undefined,
  reuse_node_id: sourceId || undefined,
  test_credential_id: undefined,
})
