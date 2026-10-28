import type {
  ConnectionConfigurationResponse,
  EndUserConnectionResponse,
  WebAppConnectionRequirement,
} from '@dify/contracts/api/web/types.gen'
import { describe, expect, it } from 'vite-plus/test'
import { getConnectionData } from '../connection-data'

function requirement(
  overrides: Partial<WebAppConnectionRequirement> = {},
): WebAppConnectionRequirement {
  return {
    node_id: 'source-one',
    icon: '/provider-icon.svg',
    icon_dark: null,
    plugin_unique_identifier: 'langgenius/github:1.0.0@digest',
    node_ids: ['source-one'],
    provider: 'langgenius/github/github',
    provider_label: 'GitHub',
    title: 'Repository connection',
    purpose: 'Read repository documentation.',
    allowed_credential_types: ['oauth2', 'api-key'],
    ...overrides,
  }
}

function connection(overrides: Partial<EndUserConnectionResponse> = {}): EndUserConnectionResponse {
  return {
    id: 'connection-one',
    provider: 'langgenius/github/github',
    name: 'Research account',
    account_label: 'research@example.com',
    credential_type: 'oauth2',
    credential_status: 'connected',
    created_at: 1,
    updated_at: 1,
    last_active_at: 1,
    expires_at: null,
    ...overrides,
  }
}

describe('Webapp connection data', () => {
  it('adapts provider light and dark asset URLs for the existing AppIcon presentation', () => {
    const data = getConnectionData({
      requirements: [requirement({ icon: '/provider-light.svg', icon_dark: '/provider-dark.svg' })],
      connections: [],
      allConnectionsLoaded: true,
    })

    expect(data.services[0]?.icon).toEqual({ icon_type: 'link', icon: '/provider-light.svg' })
    expect(data.services[0]?.iconDark).toEqual({ icon_type: 'link', icon: '/provider-dark.svg' })
  })

  it('keeps independent selections for the same provider and maps reuse nodes to their source', () => {
    const first = connection()
    const second = connection({ id: 'connection-two', account_label: 'work@example.com' })
    const data = getConnectionData({
      requirements: [
        requirement({ node_ids: ['source-one', 'reuse-one', 'reuse-two'] }),
        requirement({ node_id: 'source-two', node_ids: ['source-two'] }),
      ],
      connections: [first, second],
      configuration: { connections: { 'source-one': first, 'source-two': second } },
      allConnectionsLoaded: true,
    })

    expect(data.services.map((service) => service.id)).toEqual(['source-one', 'source-two'])
    expect(data.services.map((service) => service.selectedConnectionId)).toEqual([
      'connection-one',
      'connection-two',
    ])
    expect(data.selections).toEqual({
      'source-one': 'connection-one',
      'source-two': 'connection-two',
    })
    expect(data.sourceNodeByNodeId).toEqual({
      'source-one': 'source-one',
      'reuse-one': 'source-one',
      'reuse-two': 'source-one',
      'source-two': 'source-two',
    })
    expect(data.services[0]?.name).toBe('Repository connection')
    expect(data.services[0]?.description).toBe('Read repository documentation.')
  })

  it('filters each source by both provider and its allowed credential methods', () => {
    const data = getConnectionData({
      requirements: [requirement({ allowed_credential_types: ['api-key'] })],
      connections: [
        connection(),
        connection({ id: 'key-one', credential_type: 'api-key' }),
        connection({
          id: 'other-provider-key',
          provider: 'another/provider',
          credential_type: 'api-key',
        }),
      ],
      allConnectionsLoaded: true,
    })

    expect(data.services[0]?.methods).toEqual(['api-key'])
    expect(data.services[0]?.availableConnections.map((item) => item.id)).toEqual(['key-one'])
    expect(data.selections).toEqual({ 'source-one': null })
  })

  it('uses credential type and status from the API and preserves the appropriate display names', () => {
    const data = getConnectionData({
      requirements: [requirement()],
      connections: [
        connection(),
        connection({
          id: 'expired-oauth',
          account_label: null,
          credential_status: 'reconnect_required',
        }),
        connection({
          id: 'invalid-key',
          credential_type: 'api-key',
          name: 'Personal API key',
          credential_status: 'invalid',
        }),
      ],
      allConnectionsLoaded: true,
    })

    expect(data.services[0]?.methods).toEqual(['oauth', 'api-key'])
    expect(data.services[0]?.availableConnections).toEqual([
      { id: 'connection-one', name: 'research@example.com', method: 'oauth', status: 'active' },
      { id: 'expired-oauth', name: 'Research account', method: 'oauth', status: 'expired' },
      { id: 'invalid-key', name: 'Personal API key', method: 'api-key', status: 'invalid' },
    ])
  })

  it('includes an existing selection from configuration while the remaining pages are loading', () => {
    const selected = connection({ id: 'next-page-account' })
    const data = getConnectionData({
      requirements: [requirement()],
      connections: [connection()],
      configuration: { connections: { 'source-one': selected } },
      allConnectionsLoaded: false,
    })

    expect(data.services[0]?.selectedConnectionId).toBe('next-page-account')
    expect(data.services[0]?.availableConnections.map((item) => item.id)).toEqual([
      'connection-one',
      'next-page-account',
    ])
  })

  it('clears a saved selection absent from the complete list instead of selecting the first account', () => {
    const data = getConnectionData({
      requirements: [requirement()],
      connections: [connection()],
      configuration: { connections: { 'source-one': connection({ id: 'removed-account' }) } },
      allConnectionsLoaded: true,
    })

    expect(data.selections).toEqual({ 'source-one': null })
    expect(data.services[0]?.selectedConnectionId).toBeUndefined()
  })

  const missingConfigurations: (ConnectionConfigurationResponse | undefined)[] = [
    undefined,
    { connections: {} },
    { connections: { 'source-one': null } },
  ]

  it.each(missingConfigurations)(
    'keeps the source unselected without a saved connection: %j',
    (configuration) => {
      const data = getConnectionData({
        requirements: [requirement()],
        connections: [connection()],
        configuration,
        allConnectionsLoaded: true,
      })

      expect(data.selections).toEqual({ 'source-one': null })
      expect(data.services[0]?.selectedConnectionId).toBeUndefined()
    },
  )

  it('restores configuration by the source node key rather than a reuse node key', () => {
    const data = getConnectionData({
      requirements: [requirement({ node_ids: ['source-one', 'reuse-one'] })],
      connections: [connection()],
      configuration: { connections: { 'reuse-one': connection() } },
      allConnectionsLoaded: true,
    })

    expect(data.selections).toEqual({ 'source-one': null })
  })

  it.each([
    connection({ provider: 'another/provider' }),
    connection({ credential_type: 'api-key' }),
  ])(
    'does not restore configuration for an incompatible provider or credential type',
    (configured) => {
      const data = getConnectionData({
        requirements: [requirement({ allowed_credential_types: ['oauth2'] })],
        connections: [],
        configuration: { connections: { 'source-one': configured } },
        allConnectionsLoaded: false,
      })

      expect(data.selections).toEqual({ 'source-one': null })
      expect(data.services[0]?.availableConnections).toEqual([])
    },
  )

  it('uses the latest list status over the configuration summary and retains the warning selection', () => {
    const data = getConnectionData({
      requirements: [requirement()],
      connections: [connection({ credential_status: 'reconnect_required' })],
      configuration: { connections: { 'source-one': connection() } },
      allConnectionsLoaded: false,
    })

    expect(data.selections).toEqual({ 'source-one': 'connection-one' })
    expect(data.services[0]?.availableConnections).toEqual([
      { id: 'connection-one', name: 'research@example.com', method: 'oauth', status: 'expired' },
    ])
  })

  it('does not resurrect an incompatible list entry from an older configuration summary', () => {
    const data = getConnectionData({
      requirements: [requirement({ allowed_credential_types: ['oauth2'] })],
      connections: [connection({ credential_type: 'api-key' })],
      configuration: { connections: { 'source-one': connection() } },
      allConnectionsLoaded: false,
    })

    expect(data.selections).toEqual({ 'source-one': null })
    expect(data.services[0]?.availableConnections).toEqual([])
  })

  it('applies a local source selection independently and permits explicitly clearing the other source', () => {
    const first = connection()
    const second = connection({ id: 'connection-two' })
    const data = getConnectionData({
      requirements: [
        requirement(),
        requirement({ node_id: 'source-two', node_ids: ['source-two'] }),
      ],
      connections: [first, second],
      configuration: { connections: { 'source-one': first, 'source-two': first } },
      selectionOverrides: { 'source-one': 'connection-two', 'source-two': null },
      allConnectionsLoaded: true,
    })

    expect(data.selections).toEqual({ 'source-one': 'connection-two', 'source-two': null })
    expect(data.services.map((service) => service.selectedConnectionId)).toEqual([
      'connection-two',
      undefined,
    ])
  })

  it.each(['invalid', 'reconnect_required'] as const)(
    'retains a local selection that later becomes %s so the UI can show its warning',
    (credential_status) => {
      const data = getConnectionData({
        requirements: [requirement()],
        connections: [connection({ credential_status })],
        selectionOverrides: { 'source-one': 'connection-one' },
        allConnectionsLoaded: true,
      })

      expect(data.selections).toEqual({ 'source-one': 'connection-one' })
      expect(data.services[0]?.selectedConnectionId).toBe('connection-one')
      expect(data.services[0]?.availableConnections[0]?.status).not.toBe('active')
    },
  )

  it.each([
    { connections: [] },
    { connections: [connection({ provider: 'another/provider' })] },
    { connections: [connection({ credential_type: 'api-key' })] },
  ])(
    'clears a local selection when it is removed or no longer matches its source',
    ({ connections }) => {
      const data = getConnectionData({
        requirements: [requirement({ allowed_credential_types: ['oauth2'] })],
        connections,
        configuration: { connections: { 'source-one': connection({ id: 'saved-account' }) } },
        selectionOverrides: { 'source-one': 'connection-one' },
        allConnectionsLoaded: true,
      })

      expect(data.selections).toEqual({ 'source-one': null })
      expect(data.services[0]?.selectedConnectionId).toBeUndefined()
    },
  )
})
