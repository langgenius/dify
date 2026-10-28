import type { ConnectionsState } from '../connections/use-connections'
import type { WebAppAddress } from '@/service/webapp-address'
import { resolveWebAppAddress } from '@/service/webapp-address'
import { getWebAppAuthSessionSnapshot } from '@/service/webapp-auth'

export type WorkflowRunSnapshot = Readonly<{
  address: WebAppAddress
  authSession: number
  configuration: ConnectionsState['runConfiguration']
}>

export function captureWorkflowRunConfiguration(connections: ConnectionsState | null) {
  if (!connections) return undefined
  if (!connections.canRun) return false
  const address = resolveWebAppAddress()
  if (!address || address.kind !== 'default') return false
  const configuration = connections.runConfiguration
  return {
    address,
    authSession: getWebAppAuthSessionSnapshot(),
    configuration: configuration
      ? { ...configuration, connections: { ...configuration.connections } }
      : null,
  } satisfies WorkflowRunSnapshot
}

export function isWorkflowRunSnapshotCurrent(snapshot: WorkflowRunSnapshot) {
  const address = resolveWebAppAddress()
  return (
    snapshot.authSession === getWebAppAuthSessionSnapshot() &&
    snapshot.address.kind === address?.kind &&
    snapshot.address.code === address.code
  )
}
