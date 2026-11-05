import type { ConnectionsState } from '../connections/use-connections'
import type { WebAppAddress } from '@/service/webapp-address'
import { isInstalledAppPath } from '@/app/components/explore/installed-app/routes'
import { resolveWebAppAddress } from '@/service/webapp-address'
import { getWebAppAuthSessionSnapshot } from '@/service/webapp-auth'
import { basePath } from '@/utils/var'

type RunConnections = Pick<ConnectionsState, 'canRun' | 'runConfiguration'>

export type WorkflowRunSnapshot =
  | Readonly<{
      address: WebAppAddress
      authSession: number
      configuration: ConnectionsState['runConfiguration']
    }>
  | Readonly<{
      installedAppId: string
      configuration: ConnectionsState['runConfiguration']
    }>

export function captureWorkflowRunConfiguration(
  connections: RunConnections | null,
  installedAppId?: string,
) {
  if (!connections) return undefined
  if (!connections.canRun) return false
  const configuration = connections.runConfiguration
  if (installedAppId) {
    return {
      installedAppId,
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
  if ('installedAppId' in snapshot)
    return isInstalledAppPath(
      window.location.pathname.slice(basePath.length),
      snapshot.installedAppId,
    )
  const address = resolveWebAppAddress()
  return (
    snapshot.authSession === getWebAppAuthSessionSnapshot() &&
    snapshot.address.kind === address?.kind &&
    snapshot.address.code === address.code
  )
}
