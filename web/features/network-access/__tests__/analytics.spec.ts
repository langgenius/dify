import { trackEvent } from '@/app/components/base/amplitude'
import {
  getAccessControlFailReason,
  getIpPolicyFailReason,
  getProtectedAccessPoints,
  trackNetworkAccessEvent,
} from '../analytics'

vi.mock('@/app/components/base/amplitude', () => ({ trackEvent: vi.fn() }))

it('maps API scopes to the analytics vocabulary', () => {
  expect(getProtectedAccessPoints(['webapp', 'service_api', 'mcp', 'trigger'])).toEqual([
    'web_app',
    'service_api',
    'mcp_server',
    'trigger',
  ])
})

it('only forwards allowlisted properties and excludes application context from Settings forms', () => {
  const properties = {
    action: 'form_opened' as const,
    mode: 'edit' as const,
    source: 'list_row' as const,
    policy_id: 'policy-1',
    name: 'Private',
    allowed_cidrs: ['203.0.113.42/32'],
    client_ip: '203.0.113.42',
    app_id: 'unrelated-app',
    app_mode: 'chat',
    access_point_total: 3,
  }
  trackNetworkAccessEvent('ip_policy_interaction', properties)
  expect(trackEvent).toHaveBeenLastCalledWith('ip_policy_interaction', {
    action: 'form_opened',
    mode: 'edit',
    source: 'list_row',
    policy_id: 'policy-1',
  })
})

it.each([
  [403, 'This feature requires a paid plan.', 'plan', 'permission'],
  [403, 'Network access groups are not available for this workspace.', 'plan', 'permission'],
  [
    403,
    'Your workspace role does not allow this network access operation.',
    'permission',
    'permission',
  ],
  [401, 'Unauthorized', 'permission', 'permission'],
  [503, 'Unavailable', 'network', 'network'],
  [409, 'This workspace has reached the network access group limit.', 'other', 'limit_exceeded'],
  [409, 'The network access resource changed. Refresh it and try again.', 'other', 'other'],
  [409, 'A network access group with this name already exists.', 'other', 'other'],
  [400, 'Invalid request', 'other', 'other'],
])(
  'classifies HTTP %i failures without forwarding error text',
  async (status, message, accessReason, policyReason) => {
    const error = Response.json({ message }, { status })
    expect(await getAccessControlFailReason(error)).toBe(accessReason)
    expect(await getIpPolicyFailReason(error)).toBe(policyReason)
    expect(error.bodyUsed).toBe(false)
  },
)

it('recognizes fetch failures without labelling arbitrary exceptions as network errors', async () => {
  expect(await getAccessControlFailReason(new TypeError('Failed to fetch'))).toBe('network')
  expect(await getIpPolicyFailReason(new Error('Unexpected failure'))).toBe('other')
})

it('still classifies the status when an error response body has already been consumed', async () => {
  const response = Response.json({ message: 'Unavailable' }, { status: 503 })
  await response.json()
  expect(await getAccessControlFailReason(response)).toBe('network')
  expect(await getIpPolicyFailReason(response)).toBe('network')
})
