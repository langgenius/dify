import type { ApiKeyModalDataSource } from '../authorize/api-key-modal'
import type { ConnectionPickerOption } from '../connection-picker'
import type { usePluginAuth } from '../hooks/use-plugin-auth'
import type { Credential, PluginPayload } from '../types'
import type { ConnectionActionsDataSource } from './connection-actions'
import type { CredentialPermission } from '@/models/permission'
import { Button } from '@langgenius/dify-ui/button'
import { createDropdownMenuHandle } from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { useCredentialPermissions } from '@/hooks/use-credential-permissions'
import { openOAuthPopup } from '@/hooks/use-oauth'
import { PermissionLevel } from '@/models/permission'
import { consoleQuery } from '@/service/console'
import ApiKeyModal from '../authorize/api-key-modal'
import OAuthClientSettings from '../authorize/oauth-client-settings'
import OAuthVisibilityDialog from '../authorize/oauth-visibility-dialog'
import ConnectionPicker from '../connection-picker'
import { useOAuthClient } from '../hooks/use-oauth-client'
import { CredentialTypeEnum } from '../types'
import ConnectionActions, { ConnectionActionsTrigger } from './connection-actions'

export type ConnectionSelectorProps = {
  pluginPayload: PluginPayload
  authorization: ReturnType<typeof usePluginAuth>
  credentialId?: string
  providerName?: string
  onAuthorizationItemClick: (id: string) => void
  onDefaultCredentialChange?: (id?: string) => void
}

export type ConnectionSelectorDataSource = {
  credentials: Credential[]
  selectedCredential?: Credential
  fallbackName: string
  unavailable?: boolean
  canUse: boolean
  canCreate: boolean
  canOAuth: boolean
  canApiKey: boolean
  allowCustom: boolean
  oauthDisabled?: boolean
  providerName?: string
  subtitle: (credential?: Credential) => string
  select: (credential: Credential) => void
  addOAuth: () => void
  openOAuthClientSettings: () => void
} & (
  | {
      pluginPayload: PluginPayload
      onUpdate: () => void
      apiKey?: undefined
      connectionActions?: undefined
    }
  | {
      pluginPayload?: PluginPayload
      apiKey: ApiKeyModalDataSource
      connectionActions: ConnectionActionsDataSource
    }
)

const ConnectionSelectorContent = ({
  dataSource,
}: {
  dataSource: ConnectionSelectorDataSource
}) => {
  const { t } = useTranslation(['common', 'plugin', 'datasetSettings'])
  const [open, setOpen] = useState(false)
  const [connectionActionsHandle] = useState(() => createDropdownMenuHandle<Credential>())
  const [apiKeySession, setApiKeySession] = useState(0)
  const [apiKeyOpen, setApiKeyOpen] = useState(false)
  const { credentials } = dataSource
  const toOption = (credential: Credential): ConnectionPickerOption => ({
    id: credential.id,
    name: credential.name,
    subtitle: dataSource.subtitle(credential),
    method: credential.credential_type ?? CredentialTypeEnum.API_KEY,
    disabled: !dataSource.canUse || credential.not_allowed_to_use,
    info: credential.from_other_member
      ? t(($) => $['auth.onlyAtCreationHintTooltip'], { ns: 'plugin' })
      : undefined,
  })
  const groups = [
    {
      label: t(($) => $['userProfile.workspace'], { ns: 'common' }),
      items: credentials.filter(
        (credential) =>
          credential.visibility !== PermissionLevel.onlyMe && !credential.from_other_member,
      ),
    },
    {
      label: t(($) => $['form.permissionsOnlyMe'], { ns: 'datasetSettings' }),
      items: credentials.filter(
        (credential) =>
          credential.visibility === PermissionLevel.onlyMe && !credential.from_other_member,
      ),
    },
    {
      label: t(($) => $['auth.connection.otherMembers'], { ns: 'plugin' }),
      items: credentials.filter((credential) => credential.from_other_member),
    },
  ].map((group) => ({ ...group, items: group.items.map(toOption) }))
  const addOAuth = () => {
    if (!dataSource.allowCustom || dataSource.oauthDisabled) return
    setOpen(false)
    dataSource.addOAuth()
  }
  const addApiKey = () => {
    if (!dataSource.allowCustom || !dataSource.canCreate) return
    setOpen(false)
    setApiKeySession((session) => session + 1)
    setApiKeyOpen(true)
  }
  const openOAuthClientSettings = () => {
    if (!dataSource.allowCustom || dataSource.oauthDisabled) return
    setOpen(false)
    dataSource.openOAuthClientSettings()
  }

  return (
    <>
      {credentials.length || !dataSource.connectionActions ? (
        <ConnectionPicker
          open={open}
          onOpenChange={setOpen}
          groups={groups}
          selected={
            dataSource.selectedCredential ? toOption(dataSource.selectedCredential) : undefined
          }
          fallbackName={dataSource.fallbackName}
          unavailable={dataSource.unavailable}
          onSelect={(id) => {
            const credential = credentials.find((item) => item.id === id)
            if (!credential || !dataSource.canUse || credential.not_allowed_to_use) return
            dataSource.select(credential)
            setOpen(false)
          }}
          renderActions={(id) => {
            const credential = credentials.find((item) => item.id === id)
            return credential ? (
              <ConnectionActionsTrigger
                handle={connectionActionsHandle}
                credential={credential}
                dataSource={dataSource.connectionActions}
              />
            ) : null
          }}
          actions={
            dataSource.allowCustom
              ? {
                  addOAuth: dataSource.canOAuth
                    ? { onClick: addOAuth, disabled: dataSource.oauthDisabled }
                    : undefined,
                  addApiKey: dataSource.canApiKey
                    ? { onClick: addApiKey, disabled: !dataSource.canCreate }
                    : undefined,
                  oauthClientSettings: dataSource.canOAuth
                    ? { onClick: openOAuthClientSettings, disabled: dataSource.oauthDisabled }
                    : undefined,
                }
              : undefined
          }
        />
      ) : (
        <div className="flex items-center gap-2">
          {dataSource.canOAuth && (
            <div className="flex min-w-0 flex-1">
              <Button
                variant="primary"
                className="h-8 min-w-0 flex-1 rounded-r-none"
                disabled={!dataSource.allowCustom || dataSource.oauthDisabled}
                onClick={addOAuth}
              >
                {t(($) => $['auth.addOAuth'], { ns: 'plugin' })}
              </Button>
              <div
                aria-hidden
                className="h-4 w-px shrink-0 self-center bg-text-primary-on-surface opacity-15"
              />
              <IconButton
                variant="primary"
                size="lg"
                className="shrink-0 rounded-l-none"
                disabled={!dataSource.allowCustom || dataSource.oauthDisabled}
                aria-label={t(($) => $['auth.oauthClientSettings'], { ns: 'plugin' })}
                onClick={openOAuthClientSettings}
              >
                <span aria-hidden className="i-ri-equalizer-2-line size-4" />
              </IconButton>
            </div>
          )}
          {dataSource.canOAuth && dataSource.canApiKey && (
            <span className="system-2xs-medium-uppercase text-text-tertiary">
              {t(($) => $['auth.appUser.connectionOr'], { ns: 'plugin' })}
            </span>
          )}
          {dataSource.canApiKey && (
            <Button
              variant={dataSource.canOAuth ? 'secondary-accent' : 'primary'}
              className="min-w-0 flex-1"
              disabled={!dataSource.allowCustom || !dataSource.canCreate}
              onClick={addApiKey}
            >
              {t(($) => $['auth.common.addApiKey'], { ns: 'plugin' })}
            </Button>
          )}
        </div>
      )}
      {dataSource.connectionActions ? (
        <ConnectionActions
          handle={connectionActionsHandle}
          dataSource={dataSource.connectionActions}
          pluginPayload={dataSource.pluginPayload}
          providerName={dataSource.providerName}
          onAction={() => setOpen(false)}
        />
      ) : (
        <ConnectionActions
          handle={connectionActionsHandle}
          pluginPayload={dataSource.pluginPayload}
          providerName={dataSource.providerName}
          onAction={() => setOpen(false)}
          onUpdate={dataSource.onUpdate}
        />
      )}
      {apiKeySession > 0 &&
        (dataSource.apiKey ? (
          <ApiKeyModal
            key={apiKeySession}
            dataSource={dataSource.apiKey}
            pluginPayload={dataSource.pluginPayload}
            open={apiKeyOpen}
            onOpenChange={setApiKeyOpen}
            disabled={!dataSource.canCreate}
          />
        ) : (
          <ApiKeyModal
            key={apiKeySession}
            pluginPayload={dataSource.pluginPayload}
            open={apiKeyOpen}
            onOpenChange={setApiKeyOpen}
            disabled={!dataSource.canCreate}
            onUpdate={dataSource.onUpdate}
          />
        ))}
    </>
  )
}

const WorkspaceConnectionSelector = ({
  pluginPayload,
  authorization,
  credentialId,
  providerName,
  onAuthorizationItemClick,
  onDefaultCredentialChange,
}: ConnectionSelectorProps) => {
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
  const providerApi = consoleQuery.workspaces.current.toolProvider.builtin.byProvider
  const params = { provider: pluginPayload.provider }
  const apiKeySchema = useQuery(
    providerApi.credential.schema.byCredentialType.get.queryOptions({
      input: canApiKey
        ? { params: { ...params, credential_type: CredentialTypeEnum.API_KEY } }
        : skipToken,
    }),
  )
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
      for (const field of apiKeySchema.data || []) {
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
      <ConnectionSelectorContent
        dataSource={{
          credentials,
          selectedCredential,
          fallbackName: selectedName,
          unavailable,
          canUse: canUseCredential,
          canCreate: canCreateCredential,
          canOAuth: !!canOAuth,
          canApiKey: !!canApiKey,
          allowCustom: !notAllowCustomCredential,
          oauthDisabled: !canManageCredential || oauthSchema.isPending || oauthSchema.isError,
          pluginPayload,
          onUpdate: invalidPluginCredentialInfo,
          providerName,
          subtitle,
          select: (credential) => {
            if (!canUseCredential) return
            const id = credential.is_default ? '' : credential.id
            onAuthorizationItemClick(
              id || (onDefaultCredentialChange ? defaultCredential?.id || '' : ''),
            )
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

const ConnectionSelector = (
  props: ConnectionSelectorProps | { dataSource: ConnectionSelectorDataSource },
) => {
  if ('dataSource' in props) return <ConnectionSelectorContent dataSource={props.dataSource} />
  return <WorkspaceConnectionSelector {...props} />
}

export default memo(ConnectionSelector)
