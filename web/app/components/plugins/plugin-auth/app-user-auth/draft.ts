import type { TestConnectionDraft } from './test-connection/model'

export type AuthorizationTab = 'workspace-auth' | 'app-user-auth' | 'reuse-from-node'

export type OAuthClientDraft = { type: 'default' | 'custom' }

export type AppUserAuthDraft = {
  oauthEnabled: boolean
  apiKeyEnabled: boolean
  description: string
  client?: OAuthClientDraft
  testConnection?: TestConnectionDraft
}

export type AppUserAuthErrors = {
  methods: boolean
  oauthClient: boolean
  description: boolean
}

export const createAppUserAuthDraft = ({
  canOAuth = true,
  canApiKey = true,
  defaultClientAvailable = false,
}: {
  canOAuth?: boolean
  canApiKey?: boolean
  defaultClientAvailable?: boolean
} = {}): AppUserAuthDraft => ({
  oauthEnabled: canOAuth,
  apiKeyEnabled: canApiKey,
  description: '',
  client: defaultClientAvailable ? { type: 'default' } : undefined,
})

export const validateAppUserAuth = (draft: AppUserAuthDraft): AppUserAuthErrors => ({
  methods: !draft.oauthEnabled && !draft.apiKeyEnabled,
  oauthClient: draft.oauthEnabled && !draft.client,
  description: !draft.description.trim() || draft.description.length > 50,
})
