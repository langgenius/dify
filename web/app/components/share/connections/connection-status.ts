import type { ConnectionPreflightStatus } from '@dify/contracts/api/web/types.gen'
import type { RequiredConnectionService } from './required-services'

export function getServiceConnectionStatus(
  service: RequiredConnectionService,
  connection: RequiredConnectionService['availableConnections'][number] | undefined,
): ConnectionPreflightStatus['status'] {
  if (!connection) return 'disconnected'
  if (connection.id === service.selectedConnectionId && service.preflight)
    return service.preflight.status
  if (connection.status === 'expired') return 'reconnect_required'
  return connection.status === 'invalid' ? 'invalid' : 'connected'
}
