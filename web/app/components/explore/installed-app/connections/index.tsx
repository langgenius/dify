'use client'

import type { WebAppConnectionRequirement } from '@dify/contracts/api/console/installed-apps/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { Spinner } from '@langgenius/dify-ui/spinner'
import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { usePluginAuth } from '@/app/components/plugins/plugin-auth/hooks/use-plugin-auth'
import { AuthCategory } from '@/app/components/plugins/plugin-auth/types'
import WorkspaceConnectionItem from '@/app/components/plugins/plugin-auth/workspace-auth/workspace-connection-item'
import ConfigureConnectionsButton from '@/app/components/share/connections/configure-connections-button'
import ConnectionLoadState from '@/app/components/share/connections/connection-load-state'
import { selectToolsWithProvider } from '@/app/components/tools/utils/query-select'
import { consoleQuery } from '@/service/console'
import {
  useInstalledAppConnections,
  useOptionalInstalledAppConnections,
} from './use-installed-app-connections'

function InstalledConnectionRow({
  requirement,
  disabled,
  showMissingConnectionWarning,
}: {
  requirement: WebAppConnectionRequirement
  disabled: boolean
  showMissingConnectionWarning: boolean
}) {
  const state = useInstalledAppConnections()
  const { data: tools } = useQuery(
    consoleQuery.workspaces.current.tools.builtin.get.queryOptions({
      select: selectToolsWithProvider,
    }),
  )
  const collection = tools?.find(
    (item) => item.id === requirement.provider || item.name === requirement.provider,
  )
  const pluginPayload = {
    category: AuthCategory.tool,
    provider: collection?.name || requirement.provider,
    providerType: collection?.type,
  }
  const authorization = usePluginAuth(pluginPayload, true)
  const selectedId = state.selections[requirement.node_id]
  const preflight = state.preflight?.connections.find(
    (connection) => connection.node_id === requirement.node_id,
  )
  const availableIds = new Set(
    state.credentials
      .filter((credential) => credential.provider === requirement.provider)
      .map((credential) => credential.id),
  )

  return (
    <WorkspaceConnectionItem
      name={requirement.provider_label}
      description={requirement.purpose}
      icon={{ icon_type: 'link', icon: requirement.icon }}
      iconDark={
        requirement.icon_dark ? { icon_type: 'link', icon: requirement.icon_dark } : undefined
      }
      status={preflight?.status}
      showMissingConnectionWarning={showMissingConnectionWarning}
      pluginPayload={pluginPayload}
      authorization={{
        ...authorization,
        credentials: authorization.credentials.filter(
          (credential) =>
            availableIds.has(credential.id) &&
            !!credential.credential_type &&
            requirement.allowed_credential_types.includes(credential.credential_type),
        ),
        canOAuth:
          !!authorization.canOAuth && requirement.allowed_credential_types.includes('oauth2'),
        canApiKey:
          !!authorization.canApiKey && requirement.allowed_credential_types.includes('api-key'),
        invalidPluginCredentialInfo: (options) =>
          Promise.all([
            authorization.invalidPluginCredentialInfo(options),
            state.retry(options),
          ]).then(() => {}),
      }}
      disabled={disabled}
      useWorkspaceDefault={false}
      credentialId={selectedId ?? undefined}
      onAuthorizationItemClick={(id) => state.onSelect(requirement.node_id, id)}
    />
  )
}

function InstalledConnectionList({
  isResponding = false,
  showMissingConnectionWarning = false,
}: {
  isResponding?: boolean
  showMissingConnectionWarning?: boolean
}) {
  const state = useInstalledAppConnections()
  const disabled = isResponding || state.isMutating || state.checking || state.status !== 'ready'

  return (
    <>
      <ul className="flex flex-col gap-2">
        {state.requirements.map((requirement) => (
          <InstalledConnectionRow
            key={requirement.node_id}
            requirement={requirement}
            disabled={disabled}
            showMissingConnectionWarning={showMissingConnectionWarning}
          />
        ))}
      </ul>
      <ConnectionLoadState error={!!state.error} onRetry={state.error ? state.retry : undefined} />
    </>
  )
}

export function InstalledConnectionSetup({
  onStart,
  isResponding = false,
}: {
  onStart: () => void
  isResponding?: boolean
}) {
  const state = useOptionalInstalledAppConnections()
  const { t } = useTranslation(['share'])
  const titleId = useId()
  if (!state || state.status === 'inactive') return null

  return (
    <section aria-labelledby={titleId} className="w-full space-y-6">
      <div className="space-y-2">
        <h2 id={titleId} className="title-2xl-semi-bold text-text-primary">
          {t(($) => $['connections.setup.title'], { ns: 'share' })}
        </h2>
        <p className="system-xs-regular text-text-tertiary">
          {t(($) => $['connections.setup.required'], {
            ns: 'share',
            count: state.requirements.length,
          })}
        </p>
      </div>
      <InstalledConnectionList isResponding={isResponding} />
      <Button
        variant="primary"
        size="large"
        disabled={!state.canConfirm || isResponding}
        loading={state.isMutating || state.status === 'loading' || state.checking}
        onClick={async () => {
          if (await state.confirmSelection()) onStart()
        }}
      >
        {t(($) => $['connections.setup.startUsingApp'], { ns: 'share' })}
      </Button>
    </section>
  )
}

export function InstalledConnectionControls({ isResponding = false }: { isResponding?: boolean }) {
  const state = useOptionalInstalledAppConnections()
  const { t } = useTranslation(['share', 'common'])
  if (!state || state.status === 'inactive') return null

  return (
    <Dialog>
      <DialogTrigger render={<ConfigureConnectionsButton warningCount={state.warningCount} />} />
      <DialogContent className="w-160">
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              {(state.status === 'loading' || state.checking || state.isMutating) && (
                <Spinner aria-label={t(($) => $.loading, { ns: 'common' })} />
              )}
              {t(($) => $['connections.configure.title'], { ns: 'share' })}
            </span>
          </DialogTitle>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody className="space-y-3">
          <InstalledConnectionList isResponding={isResponding} showMissingConnectionWarning />
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
