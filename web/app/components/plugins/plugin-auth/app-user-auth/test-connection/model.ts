import type { CredentialTypeEnum as CredentialType } from '../../types'
import type { CredentialPermission } from '@/models/permission'
import { CredentialTypeEnum } from '../../types'

export const MOCK_OAUTH_CONNECTION_NAME = 'OAuth test connection'
export const MOCK_API_KEY_CONNECTION_NAME = 'API key test connection'

// Temporary UI data for the separate test-connection API; never workspace credential IDs.
export type TestConnection = {
  id: string
  name: string
  method: CredentialType
  subtitle: string
  visibility?: CredentialPermission
  isDefault?: boolean
}

export type TestConnectionDraft = {
  connections: TestConnection[]
  selectedId?: string
}

export const createMockTestConnectionDraft = ({
  canOAuth,
  canApiKey,
}: {
  canOAuth: boolean
  canApiKey: boolean
}): TestConnectionDraft => {
  const connections: TestConnection[] = [
    ...(canOAuth
      ? [
          {
            id: 'mock-test-oauth',
            name: MOCK_OAUTH_CONNECTION_NAME,
            method: CredentialTypeEnum.OAUTH2,
            subtitle: '@test-user',
          },
        ]
      : []),
    ...(canApiKey
      ? [
          {
            id: 'mock-test-api-key',
            name: MOCK_API_KEY_CONNECTION_NAME,
            method: CredentialTypeEnum.API_KEY,
            subtitle: '•••• 7A2F',
          },
        ]
      : []),
  ]
  return { connections, selectedId: connections[0]?.id }
}

export const getEnabledTestConnectionState = (
  value: TestConnectionDraft | undefined,
  { oauthEnabled, apiKeyEnabled }: { oauthEnabled: boolean; apiKeyEnabled: boolean },
): { connections: TestConnection[]; selectedConnection: TestConnection | undefined } => {
  const draft =
    value ?? createMockTestConnectionDraft({ canOAuth: oauthEnabled, canApiKey: apiKeyEnabled })
  const connections = draft.connections.filter((connection) =>
    connection.method === CredentialTypeEnum.OAUTH2 ? oauthEnabled : apiKeyEnabled,
  )
  return {
    connections,
    selectedConnection:
      connections.find((connection) => connection.id === draft.selectedId) ?? connections[0],
  }
}
