import type { SourceConnection } from '../source-models'

const managedProviderFieldNames = new Set([
  'credentialId',
  'datasource',
  'pluginId',
  'provider',
  'providerKind',
])

const connectionStatusPriority: Record<SourceConnection['status'], number> = {
  active: 0,
  provisioning: 1,
  error: 2,
  expired: 3,
  revoked: 4,
}

export type SourceDatasourceIdentity = {
  credentialId?: string
  datasource: string
  pluginId: string
  provider: string
}

export function isManagedSourceProviderFieldName(name: string) {
  return managedProviderFieldNames.has(name)
}

export function sourceProviderUsesManagedConfiguration(fields: readonly { name: string }[]) {
  const fieldNames = new Set(fields.map((field) => field.name))
  return [...managedProviderFieldNames].every((field) => fieldNames.has(field))
}

export function sourceConnectionStatusRank(status: SourceConnection['status']) {
  return connectionStatusPriority[status]
}

export function sourceConnectionMatchesDatasource(
  connection: SourceConnection,
  identity: SourceDatasourceIdentity | undefined,
) {
  if (!identity) return false
  const configuration = connection.configuration
  return (
    configuration.pluginId === identity.pluginId &&
    configuration.provider === identity.provider &&
    configuration.datasource === identity.datasource &&
    (!identity.credentialId || configuration.credentialId === identity.credentialId)
  )
}

export function findSourceProviderConnection(
  connections: readonly SourceConnection[],
  providerId: string | undefined,
  identity: SourceDatasourceIdentity | undefined,
) {
  if (!providerId || !identity) return undefined
  return [...connections]
    .filter(
      (connection) =>
        connection.providerId === providerId &&
        connection.status !== 'revoked' &&
        sourceConnectionMatchesDatasource(connection, identity),
    )
    .sort(
      (left, right) =>
        sourceConnectionStatusRank(left.status) - sourceConnectionStatusRank(right.status) ||
        right.version - left.version ||
        right.updatedAt.localeCompare(left.updatedAt),
    )[0]
}
