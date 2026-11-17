import type { ConnectionsState } from '../connections/use-connections'
import type { InstalledAppConnectionsState } from '@/app/components/explore/installed-app/connections/provider'
import type { WebAppAddress } from '@/service/webapp-address'
import { resolveWebAppAddress } from '@/service/webapp-address'
import { getWebAppAuthSessionSnapshot } from '@/service/webapp-auth'

type RunConnections = Pick<ConnectionsState, 'canRun' | 'runConfiguration'>
type InstalledRunSession = Pick<InstalledAppConnectionsState, 'installedAppId' | 'isCurrentSession'>

export type WorkflowRunSnapshot =
  | Readonly<{
      address: WebAppAddress
      authSession: number
      configuration: ConnectionsState['runConfiguration']
    }>
  | Readonly<
      InstalledRunSession & {
        configuration: ConnectionsState['runConfiguration']
      }
    >

export function captureWorkflowRunConfiguration(
  connections: RunConnections | null,
  installedSession?: InstalledRunSession | null,
) {
  if (!connections) return undefined
  if (!connections.canRun) return false
  const configuration = connections.runConfiguration
  if (installedSession) {
    if (!installedSession.isCurrentSession()) return false
    return {
      installedAppId: installedSession.installedAppId,
      isCurrentSession: installedSession.isCurrentSession,
      configuration: configuration
        ? { ...configuration, connections: { ...configuration.connections } }
        : null,
    } satisfies WorkflowRunSnapshot
  }
  const address = resolveWebAppAddress()
  if (!address || address.kind !== 'default') return false
  return {
    address,
    authSession: getWebAppAuthSessionSnapshot(),
    configuration: configuration
      ? { ...configuration, connections: { ...configuration.connections } }
      : null,
  } satisfies WorkflowRunSnapshot
}

export function isWorkflowRunSnapshotCurrent(snapshot: WorkflowRunSnapshot) {
  if ('installedAppId' in snapshot) return snapshot.isCurrentSession()
  const address = resolveWebAppAddress()
  return (
    snapshot.authSession === getWebAppAuthSessionSnapshot() &&
    snapshot.address.kind === address?.kind &&
    snapshot.address.code === address.code
  )
}
