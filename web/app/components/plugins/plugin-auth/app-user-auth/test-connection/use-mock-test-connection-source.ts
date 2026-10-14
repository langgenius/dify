import type { Credential } from '../../types'
import type { ConnectionSelectorDataSource } from '../../workspace-auth/connection-selector'
import type { TestConnection, TestConnectionDraft } from './model'
import { useTranslation } from 'react-i18next'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { PermissionLevel } from '@/models/permission'
import { CredentialTypeEnum } from '../../types'
import { MOCK_API_KEY_CONNECTION_NAME, MOCK_OAUTH_CONNECTION_NAME } from './model'

type MockTestConnectionSourceProps = {
  value: TestConnectionDraft
  canOAuth: boolean
  canApiKey: boolean
  onChange: (draft: TestConnectionDraft) => void
  onOAuthClientSettings: () => void
  providerName?: string
}

export const useMockTestConnectionSource = ({
  value,
  canOAuth,
  canApiKey,
  onChange,
  onOAuthClientSettings,
  providerName,
}: MockTestConnectionSourceProps): ConnectionSelectorDataSource => {
  const { t } = useTranslation(['plugin'])
  const { connections } = value
  const credentials: Credential[] = connections.map((connection) => ({
    id: connection.id,
    name: connection.name,
    provider: 'mock-test-run',
    credential_type: connection.method,
    visibility: connection.visibility ?? PermissionLevel.onlyMe,
    is_default: !!connection.isDefault,
  }))
  const selectedCredential =
    credentials.find((credential) => credential.id === value.selectedId) ?? credentials[0]
  const apiKey: NonNullable<ConnectionSelectorDataSource['apiKey']> = {
    schemas: [
      {
        name: 'api_key',
        label: t(($) => $['auth.connection.apiKey'], { ns: 'plugin' }),
        type: FormTypeEnum.secretInput,
        required: true,
      },
    ],
    defaultName: `${MOCK_API_KEY_CONNECTION_NAME} ${connections.length + 1}`,
    save: async ({ credentialId, name, credentials: values, visibility }) => {
      const original = connections.find((connection) => connection.id === credentialId)
      const key = typeof values.api_key === 'string' ? values.api_key.trim() : ''
      if (!key) throw new Error('A mock API key is required')
      const connection: TestConnection = {
        ...original,
        id: original?.id ?? `mock-test-${crypto.randomUUID()}`,
        name:
          name.trim() ||
          original?.name ||
          `${MOCK_API_KEY_CONNECTION_NAME} ${connections.length + 1}`,
        method: CredentialTypeEnum.API_KEY,
        // Only keep the display value in the UI draft, never the entered key.
        subtitle: `•••• ${key.slice(-4)}`,
        visibility: original?.visibility ?? visibility,
      }
      onChange({
        connections: original
          ? connections.map((item) => (item.id === original.id ? connection : item))
          : [...connections, connection],
        selectedId: original ? selectedCredential?.id : connection.id,
      })
    },
  }

  return {
    credentials,
    selectedCredential,
    fallbackName: t(($) => $['auth.unavailable'], { ns: 'plugin' }),
    canUse: true,
    canCreate: true,
    canOAuth,
    canApiKey,
    allowCustom: true,
    providerName,
    subtitle: (credential) =>
      connections.find((connection) => connection.id === credential?.id)?.subtitle ??
      t(($) => $['auth.unavailable'], { ns: 'plugin' }),
    select: (credential) => onChange({ ...value, selectedId: credential.id }),
    addOAuth: () => {
      const connection: TestConnection = {
        id: `mock-test-${crypto.randomUUID()}`,
        name: `${MOCK_OAUTH_CONNECTION_NAME} ${connections.length + 1}`,
        method: CredentialTypeEnum.OAUTH2,
        subtitle: '@test-user',
      }
      onChange({ connections: [...connections, connection], selectedId: connection.id })
    },
    openOAuthClientSettings: onOAuthClientSettings,
    apiKey,
    connectionActions: {
      canManageConnection: () => true,
      canEditConnection: () => true,
      apiKey,
      edit: {
        canEdit: true,
        canUse: true,
        save: async ({ credential, name, visibility, setDefault }) => {
          onChange({
            ...value,
            connections: connections.map((connection) => {
              if (connection.id === credential.id)
                return {
                  ...connection,
                  name,
                  visibility:
                    visibility === PermissionLevel.onlyMe
                      ? PermissionLevel.onlyMe
                      : PermissionLevel.allTeamMembers,
                  isDefault:
                    visibility !== PermissionLevel.onlyMe && (setDefault || !!connection.isDefault),
                }
              return setDefault ? { ...connection, isDefault: false } : connection
            }),
          })
        },
      },
      remove: async (credential) => {
        const nextConnections = connections.filter((connection) => connection.id !== credential.id)
        onChange({
          connections: nextConnections,
          selectedId:
            selectedCredential?.id === credential.id
              ? nextConnections[0]?.id
              : selectedCredential?.id,
        })
      },
    },
  }
}
