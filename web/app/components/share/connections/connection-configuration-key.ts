import type {
  GetConnectionsConfigurationData,
  WebAppParametersResponse,
} from '@dify/contracts/api/web/types.gen'
import type { WebAppAddress } from '@/service/webapp-address'
import { webAppQuery } from '@/service/webapp'

type ConfigurationScope = {
  input: Pick<GetConnectionsConfigurationData, 'query'>
  address: WebAppAddress
  authSession: number
  connectionRevision: WebAppParametersResponse['connection_revision'] | undefined
  selectionSession: number
}

export function webAppConnectionConfigurationKey(scope?: ConfigurationScope) {
  const query = webAppQuery.connections.configuration.get
  // The prefix also matches a save that finishes after its session has been replaced.
  if (!scope) return ['webapp', ...query.key()] as const

  const { input, address, authSession, connectionRevision, selectionSession } = scope
  return [
    'webapp',
    ...query.queryKey({ input }),
    address,
    authSession,
    connectionRevision,
    selectionSession,
  ] as const
}
