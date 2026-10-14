import type { Credential, PluginPayload } from '../../types'
import type { ConnectionSelectorDataSource } from '../../workspace-auth/connection-selector'
import type { TestConnection, TestConnectionDraft } from './model'
import type { FormSchema } from '@/app/components/base/form/types'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { PermissionLevel } from '@/models/permission'
import { consoleQuery } from '@/service/console'
import { CredentialTypeEnum } from '../../types'
import { MOCK_API_KEY_CONNECTION_NAME, MOCK_OAUTH_CONNECTION_NAME } from './model'

type MockTestConnectionSourceProps = {
  pluginPayload: PluginPayload
  active?: boolean
  value: TestConnectionDraft
  canOAuth: boolean
  canApiKey: boolean
  onChange: (draft: TestConnectionDraft) => void
  onOAuthClientSettings: () => void
  providerName?: string
  oauthDisabled?: boolean
}

export const useMockTestConnectionSource = ({
  pluginPayload,
  active = true,
  value,
  canOAuth,
  canApiKey,
  onChange,
  onOAuthClientSettings,
  providerName,
  oauthDisabled,
}: MockTestConnectionSourceProps): ConnectionSelectorDataSource => {
  const { t } = useTranslation(['plugin'])
  const renderI18nObject = useRenderI18nObject()
  const schema = useQuery(
    consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.schema.byCredentialType.get.queryOptions(
      {
        input:
          canApiKey && active
            ? {
                params: {
                  provider: pluginPayload.provider,
                  credential_type: CredentialTypeEnum.API_KEY,
                },
              }
            : skipToken,
      },
    ),
  )
  const schemas: FormSchema[] = (schema.data ?? []).map((field) => ({
    ...field,
    label: field.label ? renderI18nObject(field.label) : field.name,
    required: !!field.required,
    help: field.help ? renderI18nObject(field.help) : undefined,
    placeholder: field.placeholder ? renderI18nObject(field.placeholder) : undefined,
    scope: field.scope ?? undefined,
    url: field.url ?? undefined,
    options: field.options?.map((option) => ({ ...option, label: renderI18nObject(option.label) })),
  }))
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
    schemas,
    isLoading: schema.isPending,
    defaultName: `${MOCK_API_KEY_CONNECTION_NAME} ${connections.length + 1}`,
    save: async ({ credentialId, name, credentials: values, visibility }) => {
      const original = connections.find((connection) => connection.id === credentialId)
      const secretField = schemas.find((field) => field.type === FormTypeEnum.secretInput)
      const value = secretField ? values[secretField.name] : undefined
      const key = typeof value === 'string' ? value.trim() : ''
      const connection: TestConnection = {
        ...original,
        id: original?.id ?? `mock-test-${crypto.randomUUID()}`,
        name:
          name.trim() ||
          original?.name ||
          `${MOCK_API_KEY_CONNECTION_NAME} ${connections.length + 1}`,
        method: CredentialTypeEnum.API_KEY,
        // Only keep the display value in the UI draft, never the entered key.
        subtitle: key ? `•••• ${key.slice(-4)}` : 'API Key',
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
    canCreate: !schema.isError,
    canOAuth,
    canApiKey,
    allowCustom: true,
    pluginPayload,
    providerName,
    oauthDisabled,
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
