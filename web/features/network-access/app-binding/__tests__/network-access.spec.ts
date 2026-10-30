import { ORPCError } from '@orpc/client'
import { ACCESS_POINT_ORDER } from '@/app/components/app/deploy/utils/access-point'
import { hasNetworkAccessErrorCode } from '@/features/network-access/errors'
import {
  accessPointsFromScopes,
  draftFromBinding,
  getAvailableAccessPoints,
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

  it('matches only defined errors with one of the requested codes', () => {
    const conflict = new ORPCError('network_access_version_conflict', {
      defined: true,
      status: 409,
    })
    expect(hasNetworkAccessErrorCode(conflict, 'network_access_version_conflict')).toBe(true)
    expect(hasNetworkAccessErrorCode(conflict, 'network_access_group_name_conflict')).toBe(false)
    expect(
      hasNetworkAccessErrorCode(
        new ORPCError('network_access_version_conflict', { status: 409 }),
        'network_access_version_conflict',
      ),
    ).toBe(false)
    expect(
      hasNetworkAccessErrorCode(
        new Response(null, { status: 409 }),
        'network_access_version_conflict',
      ),
    ).toBe(false)
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
      accessPointsFromScopes(
        {
          webApp: true,
          serviceApi: true,
          mcp: true,
          trigger: true,
        },
        ACCESS_POINT_ORDER,
      ),
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
        ['webApp', 'serviceApi', 'mcp'],
      ),
    ).toEqual(['webapp', 'service_api', 'mcp'])
  })

  it('creates an empty draft when the app has no binding', () => {
    expect(draftFromBinding(null, ACCESS_POINT_ORDER)).toEqual({
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
        ['webApp', 'serviceApi'],
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

describe('available scope mapping', () => {
  it('orders supported access points independently of response order', () => {
    expect(getAvailableAccessPoints(['mcp', 'webapp', 'service_api'])).toEqual([
      'webApp',
      'serviceApi',
      'mcp',
    ])
  })
  it('keeps an explicit empty capability list empty', () => {
    expect(getAvailableAccessPoints([])).toEqual([])
    expect(
      accessPointsFromScopes({ webApp: true, serviceApi: true, mcp: true, trigger: true }, []),
    ).toEqual([])
  })
})
