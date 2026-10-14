import type { ApiKeyModalDataSource } from '../authorize/api-key-modal'
import type { Credential, PluginPayload } from '../types'
import type { ConnectionActionsDataSource } from './connection-actions'
import type { ConnectionPickerOption } from './connection-picker'
import { Button } from '@langgenius/dify-ui/button'
import { createDropdownMenuHandle } from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PermissionLevel } from '@/models/permission'
import ApiKeyModal from '../authorize/api-key-modal'
import { CredentialTypeEnum } from '../types'
import ConnectionActions, { ConnectionActionsTrigger } from './connection-actions'
import ConnectionPicker from './connection-picker'

export type ConnectionSelectorDataSource = {
  credentials: Credential[]
  selectedCredential?: Credential
  workspaceDefault?: {
    option: ConnectionPickerOption
    selected: boolean
    select: () => void
  }
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
  // Workspace keeps its selection trigger while credentials refresh.
  emptyState?: 'picker' | 'actions'
  pluginPayload?: PluginPayload
  apiKey: ApiKeyModalDataSource
  connectionActions: ConnectionActionsDataSource
}

const ConnectionSelector = ({ dataSource }: { dataSource: ConnectionSelectorDataSource }) => {
  const { t } = useTranslation(['common', 'plugin', 'datasetSettings'])
  const [open, setOpen] = useState(false)
  const [connectionActionsHandle] = useState(() => createDropdownMenuHandle<Credential>())
  const [apiKeySession, setApiKeySession] = useState(0)
  const [apiKeyOpen, setApiKeyOpen] = useState(false)
  const { credentials, workspaceDefault } = dataSource
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
  if (workspaceDefault) groups[0]?.items.unshift(workspaceDefault.option)
  const selected = dataSource.selectedCredential
    ? toOption(dataSource.selectedCredential)
    : undefined
  const selectedOption = workspaceDefault?.selected
    ? {
        ...(selected ?? workspaceDefault.option),
        id: workspaceDefault.option.id,
        name: selected?.name ?? dataSource.fallbackName,
      }
    : selected
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
      {credentials.length || dataSource.emptyState === 'picker' ? (
        <ConnectionPicker
          open={open}
          onOpenChange={setOpen}
          groups={groups}
          selected={selectedOption}
          fallbackName={dataSource.fallbackName}
          unavailable={dataSource.unavailable}
          onSelect={(id) => {
            if (workspaceDefault && id === workspaceDefault.option.id) {
              if (!dataSource.canUse || workspaceDefault.option.disabled) return
              workspaceDefault.select()
              setOpen(false)
              return
            }
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
      <ConnectionActions
        handle={connectionActionsHandle}
        dataSource={dataSource.connectionActions}
        pluginPayload={dataSource.pluginPayload}
        providerName={dataSource.providerName}
        onAction={() => setOpen(false)}
      />
      {apiKeySession > 0 && (
        <ApiKeyModal
          key={apiKeySession}
          dataSource={dataSource.apiKey}
          pluginPayload={dataSource.pluginPayload}
          open={apiKeyOpen}
          onOpenChange={setApiKeyOpen}
          disabled={!dataSource.canCreate}
        />
      )}
    </>
  )
}

export default memo(ConnectionSelector)
