import { ORPCError } from '@orpc/client'
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
  ['paid_plan_required', 403, 'plan', 'permission'],
  ['network_access_not_entitled', 403, 'plan', 'permission'],
  ['network_access_forbidden', 403, 'permission', 'permission'],
  ['network_access_role_denied', 403, 'permission', 'permission'],
  ['billing_unavailable', 503, 'network', 'network'],
  ['billing_operation_failed', 502, 'network', 'network'],
  ['network_access_group_name_conflict', 409, 'other', 'name_conflict'],
  ['network_access_version_conflict', 409, 'other', 'other'],
  ['network_access_invalid_input', 400, 'other', 'other'],
])('classifies the %s error code', (code, status, accessReason, policyReason) => {
  const error = new ORPCError(code, { defined: true, status, message: 'Backend text' })
  expect(getAccessControlFailReason(error)).toBe(accessReason)
  expect(getIpPolicyFailReason(error)).toBe(policyReason)
})

it('ignores a plan or conflict code the contract does not define for the call', () => {
  const plan = new ORPCError('paid_plan_required', { status: 403 })
  const conflict = new ORPCError('network_access_group_name_conflict', { status: 409 })
  expect(getAccessControlFailReason(plan)).toBe('permission')
  expect(getIpPolicyFailReason(conflict)).toBe('other')
})

it.each([
  [401, 'permission'],
  [403, 'permission'],
  [503, 'network'],
  [400, 'other'],
])('falls back to the HTTP %i status for undocumented errors', (status, reason) => {
  const error = Response.json({ message: 'This feature requires a paid plan.' }, { status })
  expect(getAccessControlFailReason(error)).toBe(reason)
  expect(getIpPolicyFailReason(error)).toBe(reason)
})

it('recognizes fetch failures without labelling arbitrary exceptions as network errors', () => {
  expect(getAccessControlFailReason(new TypeError('Failed to fetch'))).toBe('network')
  expect(getIpPolicyFailReason(new Error('Unexpected failure'))).toBe('other')
})

it('still classifies the status when an error response body has already been consumed', async () => {
  const response = Response.json({ message: 'Unavailable' }, { status: 503 })
  await response.json()
  expect(getAccessControlFailReason(response)).toBe('network')
  expect(getIpPolicyFailReason(response)).toBe('network')
})
