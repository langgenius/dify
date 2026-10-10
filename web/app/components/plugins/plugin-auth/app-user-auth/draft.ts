export type AuthorizationTab = 'workspace-auth' | 'app-user-auth' | 'reuse-from-node'

export type OAuthClientDraft =
  | { type: 'default' }
  | { type: 'custom'; clientId: string; clientSecret: string }

export type AppUserAuthDraft = {
  oauthEnabled: boolean
  apiKeyEnabled: boolean
  description: string
  client?: OAuthClientDraft
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
  oauthClient:
    draft.oauthEnabled &&
    (!draft.client ||
      (draft.client.type === 'custom' &&
        (!draft.client.clientId.trim() || !draft.client.clientSecret.trim()))),
  description: !draft.description.trim() || draft.description.length > 50,
})
