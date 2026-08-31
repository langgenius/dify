import type { SourceConnection } from '../../../source-models'
import { findSourceProviderConnection, sourceConnectionMatchesDatasource } from '../model'

const identity = {
  credentialId: 'credential-1',
  datasource: 'notion',
  pluginId: 'langgenius/notion',
  provider: 'notion',
}

function connection(overrides: Partial<SourceConnection> = {}): SourceConnection {
  return {
    authKind: 'endpoint',
    configuration: identity,
    createdAt: '2026-01-01T00:00:00Z',
    id: 'connection-1',
    knowledgeSpaceId: 'space-1',
    name: 'Notion',
    providerId: 'provider-1',
    scopes: [],
    status: 'active',
    updatedAt: '2026-01-01T00:00:00Z',
    version: 1,
    ...overrides,
  }
}

describe('source connection policy', () => {
  it('requires the configured datasource identity', () => {
    expect(sourceConnectionMatchesDatasource(connection(), identity)).toBe(true)
    expect(
      sourceConnectionMatchesDatasource(connection(), { ...identity, credentialId: 'other' }),
    ).toBe(false)
  })

  it('selects by status, version, and update time in that order', () => {
    const selected = findSourceProviderConnection(
      [
        connection({ id: 'older-active', updatedAt: '2026-03-01T00:00:00Z', version: 1 }),
        connection({ id: 'newer-version', updatedAt: '2026-02-01T00:00:00Z', version: 2 }),
        connection({ id: 'provisioning', status: 'provisioning', version: 10 }),
      ],
      'provider-1',
      identity,
    )

    expect(selected?.id).toBe('newer-version')
  })

  it('does not mutate the query result while ranking connections', () => {
    const connections = [
      connection({ id: 'first', status: 'provisioning' }),
      connection({ id: 'second' }),
    ]

    findSourceProviderConnection(connections, 'provider-1', identity)

    expect(connections.map((item) => item.id)).toEqual(['first', 'second'])
  })
})
