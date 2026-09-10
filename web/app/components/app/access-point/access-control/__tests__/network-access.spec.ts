import {
  accessPointsFromScopes,
  availabilityFromAccessPoints,
  draftFromBinding,
  getNetworkAccessErrorStatus,
  scopesFromAccessPoints,
  toApiAccessPoint,
  toUiAccessPoint,
} from '../network-access'

const allAvailable = {
  webApp: true,
  serviceApi: true,
  mcp: true,
  trigger: true,
}

describe('network access mappers', () => {
  it('maps UI access points to the Console contract', () => {
    expect(toApiAccessPoint('webApp')).toBe('webapp')
    expect(toApiAccessPoint('serviceApi')).toBe('service_api')
    expect(toUiAccessPoint('webapp')).toBe('webApp')
    expect(toUiAccessPoint('service_api')).toBe('serviceApi')
  })

  it('builds availability from the server access-point matrix', () => {
    expect(availabilityFromAccessPoints(['webapp', 'service_api', 'mcp'], true)).toEqual({
      webApp: true,
      serviceApi: true,
      mcp: true,
      trigger: false,
    })
    expect(
      availabilityFromAccessPoints(['webapp', 'service_api', 'mcp', 'trigger'], false),
    ).toEqual({
      webApp: true,
      serviceApi: true,
      mcp: true,
      trigger: false,
    })
  })

  it('reads HTTP status from Response and nested response objects', () => {
    expect(getNetworkAccessErrorStatus(new Response(null, { status: 409 }))).toBe(409)
    expect(getNetworkAccessErrorStatus({ response: { status: 409 } })).toBe(409)
  })

  it('builds scopes from selected API access points and available ones', () => {
    expect(scopesFromAccessPoints(['webapp', 'mcp'], allAvailable)).toEqual({
      webApp: true,
      serviceApi: false,
      mcp: true,
      trigger: false,
    })
  })

  it('omits unavailable scopes when assembling a PUT payload', () => {
    expect(
      accessPointsFromScopes(
        { webApp: true, serviceApi: true, mcp: true, trigger: true },
        { ...allAvailable, trigger: false },
      ),
    ).toEqual(['webapp', 'service_api', 'mcp'])
  })

  it('creates an empty draft when the app has no binding', () => {
    expect(draftFromBinding(null, allAvailable)).toEqual({
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
      draftFromBinding(
        {
          id: 'binding-1',
          tenant_id: 'workspace-1',
          app_id: 'app-1',
          enabled: true,
          group_id: 'group-1',
          access_points: ['webapp', 'service_api'],
          version: 3,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        allAvailable,
      ),
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
