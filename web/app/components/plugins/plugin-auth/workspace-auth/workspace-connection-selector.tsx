import type { usePluginAuth } from '../hooks/use-plugin-auth'
import type { Credential, PluginPayload } from '../types'
import type { CredentialPermission } from '@/models/permission'
import { useMutation } from '@tanstack/react-query'
import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { useCredentialPermissions } from '@/hooks/use-credential-permissions'
import { openOAuthPopup } from '@/hooks/use-oauth'
import { PermissionLevel } from '@/models/permission'
import { consoleQuery } from '@/service/console'
import OAuthClientSettings from '../authorize/oauth-client-settings'
import OAuthVisibilityDialog from '../authorize/oauth-visibility-dialog'
import ConnectionSelector from '../connections/connection-selector'
import { useOAuthClient } from '../hooks/use-oauth-client'
import { CredentialTypeEnum } from '../types'
import { useWorkspaceConnectionOperations } from './use-workspace-connection-operations'

export type WorkspaceConnectionSelectorProps = {
  pluginPayload: PluginPayload
  authorization: ReturnType<typeof usePluginAuth>
  credentialId?: string
  providerName?: string
  onAuthorizationItemClick: (id: string) => void
  onDefaultCredentialChange?: (id?: string) => void
}

const WorkspaceConnectionSelector = ({
  pluginPayload,
  authorization,
  credentialId,
  providerName,
  onAuthorizationItemClick,
  onDefaultCredentialChange,
}: WorkspaceConnectionSelectorProps) => {
  const { t } = useTranslation(['common', 'plugin', 'datasetSettings'])
  const { canUseCredential, canCreateCredential, canManageCredential } = useCredentialPermissions()
  const {
    credentials,
    canApiKey,
    canOAuth,
    isLoading,
    notAllowCustomCredential,
    invalidPluginCredentialInfo,
  } = authorization
  const params = { provider: pluginPayload.provider }
  const operations = useWorkspaceConnectionOperations({
    pluginPayload,
    canApiKey:
      !!canApiKey ||
      credentials.some((credential) => credential.credential_type === CredentialTypeEnum.API_KEY),
    onUpdate: invalidPluginCredentialInfo,
  })
  const oauthClient = useOAuthClient(pluginPayload, !!canOAuth)
  const oauthSchema = oauthClient.query
  const [oauthSettingsSession, setOauthSettingsSession] = useState(0)
  const [oauthSettingsOpen, setOauthSettingsOpen] = useState(false)
  const [visibilityOpen, setVisibilityOpen] = useState(false)
  const [visibility, setVisibility] = useState<CredentialPermission>(PermissionLevel.onlyMe)
  const oauthAuthorization = useMutation(
    consoleQuery.oauth.plugin.byProvider.tool.authorizationUrl.get.mutationOptions({
      onSuccess: ({ authorization_url }) => {
        if (!authorization_url) return
        openOAuthPopup(authorization_url, invalidPluginCredentialInfo)
        setVisibilityOpen(false)
      },
    }),
  )

  const defaultCredential = credentials.find((credential) => credential.is_default)
  const selectedCredential = credentialId
    ? credentials.find((credential) => credential.id === credentialId)
    : defaultCredential
  const unavailable = selectedCredential?.not_allowed_to_use || (!isLoading && !selectedCredential)
  const selectedName =
    selectedCredential?.name ||
    (isLoading
      ? t(($) => $.loading, { ns: 'common' })
      : credentialId
        ? t(($) => $['auth.authRemoved'], { ns: 'plugin' })
        : t(($) => $['auth.workspaceDefault'], { ns: 'plugin' }))

  useEffect(() => {
    onDefaultCredentialChange?.(defaultCredential?.id)
  }, [defaultCredential?.id, onDefaultCredentialChange])

  const methodLabel = (credential?: Credential) =>
    credential?.credential_type === CredentialTypeEnum.OAUTH2
      ? t(($) => $['auth.connection.oauth'], { ns: 'plugin' })
      : t(($) => $['auth.connection.apiKey'], { ns: 'plugin' })
  const subtitle = (credential?: Credential) => {
    if (!credential) return t(($) => $['auth.unavailable'], { ns: 'plugin' })
    if (credential.not_allowed_to_use) return t(($) => $['auth.unavailable'], { ns: 'plugin' })
    if (credential.credential_type === CredentialTypeEnum.API_KEY) {
      for (const field of operations.apiKey.schemas) {
        if (field.type !== FormTypeEnum.secretInput) continue
        const value = credential.credentials?.[field.name]
        // Only show a schema-identified, already-masked value; never reveal raw credentials.
        const masked = typeof value === 'string' && value.match(/^[^*•]{0,2}[*•]+([^*•]{0,4})$/)
        if (masked) return `••••${masked[1] ? ` ${masked[1]}` : ''}`
      }
    }
    return methodLabel(credential)
  }
  const openOAuthSettings = () => {
    if (!canManageCredential || notAllowCustomCredential) return
    setOauthSettingsSession((session) => session + 1)
    setOauthSettingsOpen(true)
  }
  const startOAuth = () => {
    if (!canManageCredential || notAllowCustomCredential || oauthSchema.isPending) return
    if (
      oauthSchema.data?.is_system_oauth_params_exists ||
      oauthSchema.data?.is_oauth_custom_client_enabled
    ) {
      setVisibility(PermissionLevel.onlyMe)
      setVisibilityOpen(true)
    } else {
      openOAuthSettings()
    }
  }

  return (
    <>
      <ConnectionSelector
        dataSource={{
          credentials,
          selectedCredential,
          workspaceDefault: {
            option: {
              id: '__workspace_default__',
              name: t(($) => $['auth.workspaceDefault'], { ns: 'plugin' }),
              subtitle:
                defaultCredential?.name ?? t(($) => $['auth.unavailable'], { ns: 'plugin' }),
              disabled:
                !canUseCredential || !defaultCredential || defaultCredential.not_allowed_to_use,
            },
            selected: !credentialId,
            select: () =>
              onAuthorizationItemClick(
                onDefaultCredentialChange ? (defaultCredential?.id ?? '') : '',
              ),
          },
          fallbackName: selectedName,
          unavailable,
          canUse: canUseCredential,
          canCreate: canCreateCredential,
          canOAuth: !!canOAuth,
          canApiKey: !!canApiKey,
          allowCustom: !notAllowCustomCredential,
          oauthDisabled: !canManageCredential || oauthSchema.isPending || oauthSchema.isError,
          pluginPayload,
          emptyState: 'picker',
          apiKey: operations.apiKey,
          connectionActions: operations.connectionActions,
          providerName,
          subtitle,
          select: (credential) => {
            if (!canUseCredential) return
            onAuthorizationItemClick(credential.id)
          },
          addOAuth: startOAuth,
          openOAuthClientSettings: openOAuthSettings,
        }}
      />
      {oauthSettingsSession > 0 && (
        <OAuthClientSettings
          key={oauthSettingsSession}
          open={oauthSettingsOpen}
          onOpenChange={setOauthSettingsOpen}
          pluginPayload={pluginPayload}
          schemas={oauthClient.schemas}
          redirectUri={oauthClient.redirectUri}
          disabled={!canManageCredential || oauthSchema.isPending}
          editValues={oauthClient.editValues}
          hasOriginalClientParams={oauthClient.hasOriginalClientParams}
          onUpdate={() => {
            invalidPluginCredentialInfo()
            oauthSchema.refetch().catch(() => {})
          }}
          onRequestAuthorization={() => {
            setVisibility(PermissionLevel.onlyMe)
            setVisibilityOpen(true)
          }}
        />
      )}
      <OAuthVisibilityDialog
        open={visibilityOpen}
        onOpenChange={setVisibilityOpen}
        permission={visibility}
        onPermissionChange={setVisibility}
        loading={oauthAuthorization.isPending}
        onConfirm={() => {
          if (!canManageCredential || oauthAuthorization.isPending) return
          oauthAuthorization.mutate({ params, query: { visibility } })
        }}
      />
    </>
  )
}

export default memo(WorkspaceConnectionSelector)
