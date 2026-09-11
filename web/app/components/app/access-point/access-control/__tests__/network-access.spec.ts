import {
  accessPointsFromScopes,
  draftFromBinding,
  getNetworkAccessErrorStatus,
  scopesFromAccessPoints,
  toApiAccessPoint,
  toUiAccessPoint,
} from '../network-access'

describe('network access mappers', () => {
  it('maps UI access points to the Console contract', () => {
    expect(toApiAccessPoint('webApp')).toBe('webapp')
    expect(toApiAccessPoint('serviceApi')).toBe('service_api')
    expect(toUiAccessPoint('webapp')).toBe('webApp')
    expect(toUiAccessPoint('service_api')).toBe('serviceApi')
  })

  it('reads HTTP status from Response and nested response objects', () => {
    expect(getNetworkAccessErrorStatus(new Response(null, { status: 409 }))).toBe(409)
    expect(getNetworkAccessErrorStatus({ response: { status: 409 } })).toBe(409)
  })

  it('builds scopes from selected API access points', () => {
    expect(scopesFromAccessPoints(['webapp', 'mcp'])).toEqual({
      webApp: true,
      serviceApi: false,
      mcp: true,
      trigger: false,
    })
  })

  it('includes every selected access point in the PUT payload', () => {
    expect(
      accessPointsFromScopes({
        webApp: true,
        serviceApi: true,
        mcp: true,
        trigger: true,
      }),
    ).toEqual(['webapp', 'service_api', 'mcp', 'trigger'])
  })

  it('omits selected access points the backend does not accept for this app', () => {
    expect(
      accessPointsFromScopes(
        {
          webApp: true,
          serviceApi: true,
          mcp: true,
          trigger: true,
        },
        ['webapp', 'service_api', 'mcp'],
      ),
    ).toEqual(['webapp', 'service_api', 'mcp'])
  })

  it('creates an empty draft when the app has no binding', () => {
    expect(draftFromBinding(null)).toEqual({
      selectedPolicyId: null,
      enabled: true,
      scopes: {
        webApp: true,
        serviceApi: true,
        mcp: true,
        trigger: true,
      },
    })
  })

  it('hydrates a draft from a bound group', () => {
    expect(
      draftFromBinding({
        id: 'binding-1',
        tenant_id: 'workspace-1',
        app_id: 'app-1',
        enabled: true,
        group_id: 'group-1',
        access_points: ['webapp', 'service_api'],
        version: 3,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }),
    ).toEqual({
      selectedPolicyId: 'group-1',
      enabled: true,
      scopes: {
        webApp: true,
        serviceApi: true,
        mcp: false,
        trigger: false,
      },
    })
  })
})
