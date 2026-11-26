import type {
  GetInstalledAppsByInstalledAppIdConnectionsConfigurationData,
  InstalledAppParametersResponse,
} from '@dify/contracts/api/console/installed-apps/types.gen'
import type { ConsoleQuery } from './policies/types'

type ConfigurationData = GetInstalledAppsByInstalledAppIdConnectionsConfigurationData
type ConfigurationQuery =
  ConsoleQuery['installedApps']['byInstalledAppId']['connections']['configuration']['get']

export function installedAppConnectionConfigurationKey(
  query: ConfigurationQuery,
  input: Pick<ConfigurationData, 'query'> & { params: ConfigurationData['path'] },
  connectionRevision: InstalledAppParametersResponse['connection_revision'] | undefined,
) {
  return [...query.queryKey({ input }), connectionRevision] as const
}
