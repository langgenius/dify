import type { TestCredentialState } from '@dify/contracts/api/console/apps/types.gen'
import type { ToolNodeType } from '../../nodes/tool/types'
import type { Node } from '../../types'
import type { useTestConnections } from './use-test-connections'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
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
import { useGetLanguage } from '@/context/i18n'
import { consoleQuery } from '@/service/console'
import { useNodesReadOnly } from '../../hooks/use-workflow'

function TestConnectionRow({
  node,
  state,
  disabled,
  onSelect,
  showMissingConnectionWarning = false,
}: {
  node: Node<ToolNodeType>
  state?: TestCredentialState
  disabled: boolean
  onSelect: (nodeId: string, credentialId: string) => void
  showMissingConnectionWarning?: boolean
}) {
  const language = useGetLanguage()
  const { data: tools } = useQuery(
    consoleQuery.workspaces.current.tools.builtin.get.queryOptions({
      select: selectToolsWithProvider,
    }),
  )
  const collection = tools?.find(
    (item) => item.id === node.data.provider_id || item.name === node.data.provider_id,
  )
  const name = collection?.label[language] || collection?.label.en_US || node.data.provider_name
  const pluginPayload = {
    category: AuthCategory.tool,
    provider: collection?.name || node.data.provider_id,
    providerType: collection?.type,
  }
  const authorization = usePluginAuth(pluginPayload, true)
  const allowed = node.data.end_user_auth?.allowed_credential_types ?? []
  const icon = collection?.icon ?? node.data.provider_icon

  return (
    <WorkspaceConnectionItem
      name={name}
      description={node.data.title}
      icon={
        typeof icon === 'string'
          ? { icon_type: 'link', icon }
          : { icon_type: 'emoji', icon: icon?.content, icon_background: icon?.background }
      }
      status={state?.status}
      showMissingConnectionWarning={showMissingConnectionWarning}
      pluginPayload={pluginPayload}
      authorization={{
        ...authorization,
        credentials: authorization.credentials
          .filter(
            (credential) =>
              !!credential.credential_type && allowed.includes(credential.credential_type),
          )
          .map((credential) =>
            credential.from_other_member ? { ...credential, not_allowed_to_use: true } : credential,
          ),
        canOAuth: !!authorization.canOAuth && allowed.includes('oauth2'),
        canApiKey: !!authorization.canApiKey && allowed.includes('api-key'),
      }}
      useWorkspaceDefault={false}
      disabled={disabled}
      credentialId={node.data.test_credential_id ?? undefined}
      onAuthorizationItemClick={(id) => onSelect(node.id, id)}
    />
  )
}

type TestConnectionsProps = {
  connections: ReturnType<typeof useTestConnections>
  isResponding: boolean
}

function TestConnectionList({
  connections,
  isResponding,
  showMissingConnectionWarning,
}: TestConnectionsProps & {
  showMissingConnectionWarning?: boolean
}) {
  const { nodesReadOnly } = useNodesReadOnly()
  return (
    <>
      <ul className="flex flex-col gap-2 py-3">
        {connections.nodes.map((node) => (
          <TestConnectionRow
            key={node.id}
            node={node}
            state={connections.credentials.find((item) => item.node_id === node.id)}
            disabled={isResponding || connections.checking || nodesReadOnly}
            onSelect={connections.onSelect}
            showMissingConnectionWarning={showMissingConnectionWarning}
          />
        ))}
      </ul>
      <ConnectionLoadState
        error={connections.error}
        onRetry={
          connections.error
            ? () => {
                void connections.check()
              }
            : undefined
        }
      />
    </>
  )
}

export function TestConnectionSetup({ connections, isResponding }: TestConnectionsProps) {
  const { t } = useTranslation(['share', 'plugin', 'common'])
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="w-full max-w-140">
      <h2 id={titleId} className="flex items-center gap-2 title-xl-semi-bold text-text-primary">
        {connections.checking && <Spinner aria-label={t(($) => $.loading, { ns: 'common' })} />}
        {t(($) => $['connections.configure.title'], { ns: 'share' })}
      </h2>
      <p className="mt-2 system-xs-regular text-text-tertiary">
        {t(($) => $['auth.appUser.testConnectionDescription'], { ns: 'plugin' })}
      </p>
      <TestConnectionList connections={connections} isResponding={isResponding} />
    </section>
  )
}

export default function TestConnections({
  connections,
  isResponding,
  showTrigger,
}: TestConnectionsProps & {
  showTrigger: boolean
}) {
  const { t } = useTranslation(['share', 'common', 'plugin'])
  if (!connections.nodes.length) return null

  return (
    <Dialog open={connections.open} onOpenChange={connections.onOpenChange}>
      {showTrigger && (
        <DialogTrigger
          render={<ConfigureConnectionsButton warningCount={connections.warningCount} />}
        />
      )}
      <DialogContent className="w-160">
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              {connections.checking && (
                <Spinner aria-label={t(($) => $.loading, { ns: 'common' })} />
              )}
              {t(($) => $['connections.configure.title'], { ns: 'share' })}
            </span>
          </DialogTitle>
          <DialogDescription>
            {t(($) => $['auth.appUser.testConnectionDescription'], { ns: 'plugin' })}
          </DialogDescription>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody>
          <TestConnectionList
            connections={connections}
            isResponding={isResponding}
            showMissingConnectionWarning
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
