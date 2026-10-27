import type {
  ConnectionConfigurationResponse,
  EndUserConnectionResponse,
  ToolConnectionRequirement,
} from '@dify/contracts/api/web/types.gen'
import type { RequiredConnectionService } from './required-services'

const methods = { oauth2: 'oauth', 'api-key': 'api-key' } as const
const statuses = {
  connected: 'active',
  reconnect_required: 'expired',
  invalid: 'invalid',
} as const

type ConnectionDataInput = {
  requirements: readonly ToolConnectionRequirement[]
  connections: readonly EndUserConnectionResponse[]
  configuration?: ConnectionConfigurationResponse
  selectionOverrides?: Readonly<Record<string, string | null>>
  allConnectionsLoaded: boolean
}

export function getConnectionData({
  requirements,
  connections,
  configuration,
  selectionOverrides,
  allConnectionsLoaded,
}: ConnectionDataInput): {
  services: RequiredConnectionService[]
  selections: Record<string, string | null>
  sourceNodeByNodeId: Record<string, string>
} {
  const connectionsById = new Map(connections.map((connection) => [connection.id, connection]))
  const selections: [string, string | null][] = []
  const services = requirements.map((requirement): RequiredConnectionService => {
    const matchesRequirement = (connection: EndUserConnectionResponse) =>
      connection.provider === requirement.provider &&
      requirement.allowed_credential_types.includes(connection.credential_type)
    const candidates = new Map(
      [...connectionsById.values()]
        .filter(matchesRequirement)
        .map((connection) => [connection.id, connection]),
    )
    const configured = configuration?.connections[requirement.node_id]

    // Keep saved connections visible until pagination can confirm whether they still exist.
    if (
      !allConnectionsLoaded &&
      configured &&
      matchesRequirement(configured) &&
      !connectionsById.has(configured.id)
    )
      candidates.set(configured.id, configured)

    const selectedId =
      selectionOverrides && Object.hasOwn(selectionOverrides, requirement.node_id)
        ? selectionOverrides[requirement.node_id]
        : configured && matchesRequirement(configured)
          ? configured.id
          : null
    // Retain expired selections so the UI can explain why they need attention.
    const selectedConnectionId = selectedId && candidates.has(selectedId) ? selectedId : null
    selections.push([requirement.node_id, selectedConnectionId])

    return {
      id: requirement.node_id,
      name: requirement.title,
      description: requirement.purpose,
      methods: requirement.allowed_credential_types.map((type) => methods[type]),
      selectedConnectionId: selectedConnectionId ?? undefined,
      availableConnections: [...candidates.values()].map((connection) => ({
        id: connection.id,
        name:
          connection.credential_type === 'oauth2'
            ? (connection.account_label ?? connection.name)
            : connection.name,
        method: methods[connection.credential_type],
        status: statuses[connection.credential_status],
      })),
    }
  })

  return {
    services,
    selections: Object.fromEntries(selections),
    sourceNodeByNodeId: Object.fromEntries(
      requirements.flatMap((requirement) =>
        [requirement.node_id, ...requirement.node_ids].map((nodeId) => [
          nodeId,
          requirement.node_id,
        ]),
      ),
    ),
  }
}
