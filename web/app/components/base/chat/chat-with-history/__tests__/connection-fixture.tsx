import type { PropsWithChildren } from 'react'
import type { ConnectionsState } from '@/app/components/share/connections/use-connections'
import type { WebAppEntryState } from '@/app/components/share/webapp-entry'
import { ConnectionsContext } from '@/app/components/share/connections/use-connections'
import { WebAppEntryContext } from '@/app/components/share/webapp-entry'

export const checkedRevision = '55555555-5555-4555-8555-555555555555'
export const selectedConnectionId = '11111111-1111-4111-8111-111111111111'

export const chatConnectionEntry: WebAppEntryState = {
  status: 'connections-pending',
  account: 'authenticated',
  parameters: {
    account_login_enabled: true,
    account_login_url: 'https://accounts.example.com/signin',
    allow_anonymous_end_user_auth: false,
    requires_end_user_connections: true,
    connection_revision: '44444444-4444-4444-8444-444444444444',
    connection_requirements: [
      {
        node_id: 'github-node',
        node_ids: ['github-node'],
        provider: 'langgenius/github/github',
        provider_label: 'GitHub',
        allowed_credential_types: ['oauth2'],
        plugin_unique_identifier: 'langgenius/github:1.0.0@digest',
        title: 'Find repositories',
        purpose: 'Find sources for research.',
        icon: '/github.svg',
        icon_dark: null,
      },
    ],
  },
  canRun: false,
  showSignIn: false,
}

export function createChatConnections(overrides: Partial<ConnectionsState> = {}): ConnectionsState {
  return {
    services: [
      {
        id: 'github-node',
        name: 'Find repositories',
        description: 'Find sources for research.',
        methods: ['oauth'],
        selectedConnectionId,
        availableConnections: [
          {
            id: selectedConnectionId,
            name: 'research@example.com',
            method: 'oauth',
            status: 'active',
          },
        ],
      },
    ],
    selections: { 'github-node': selectedConnectionId },
    sourceNodeByNodeId: { 'github-node': 'github-node' },
    status: 'ready',
    error: null,
    onConnectionChange: vi.fn(),
    onConnect: vi.fn().mockResolvedValue(undefined),
    onReplace: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onReconnect: vi.fn().mockResolvedValue(undefined),
    isMutating: false,
    hasMoreConnections: false,
    isFetchingMoreConnections: false,
    loadMoreConnections: vi.fn(),
    retry: vi.fn(),
    canRun: true,
    runConfiguration: {
      connection_revision: checkedRevision,
      connections: { 'github-node': selectedConnectionId },
    },
    preflight: {
      status: 'ready',
      response: {
        connection_revision: checkedRevision,
        ready: true,
        connections: [
          {
            node_id: 'github-node',
            connection_id: selectedConnectionId,
            status: 'connected',
            check: null,
          },
        ],
      },
      error: null,
      canRetry: false,
      retry: vi.fn(),
    },
    ...overrides,
  }
}

export function withChatConnections({
  state,
  children,
  entry = chatConnectionEntry,
}: PropsWithChildren<{ state?: ConnectionsState; entry?: WebAppEntryState }>) {
  if (!state) return <>{children}</>
  return (
    <WebAppEntryContext value={entry}>
      <ConnectionsContext value={state}>{children}</ConnectionsContext>
    </WebAppEntryContext>
  )
}
