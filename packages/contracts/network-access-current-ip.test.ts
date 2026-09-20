import { describe, expect, it } from 'vite-plus/test'
import { currentIp, workspaces } from './generated/api/console/workspaces/orpc.gen'
import {
  zGetWorkspacesCurrentNetworkAccessGroupsByGroupIdCheckCurrentIpPath,
  zGetWorkspacesCurrentNetworkAccessGroupsByGroupIdCheckCurrentIpResponse,
  zGetWorkspacesCurrentNetworkAccessGroupsCurrentIpResponse,
} from './generated/api/console/workspaces/zod.gen'

describe('generated network access current-IP contract', () => {
  it('exposes the policy-independent operation alongside the group preflight', () => {
    expect(workspaces.current.networkAccessGroups.currentIp.get).toBe(currentIp.get)
    expect(workspaces.current.networkAccessGroups.byGroupId.checkCurrentIp.get).toBeDefined()
  })

  it.each(['192.0.2.1', '2001:db8::1'])('accepts a trusted IP without a saved policy: %s', (ip) => {
    expect(
      zGetWorkspacesCurrentNetworkAccessGroupsCurrentIpResponse.parse({ client_ip: ip }),
    ).toEqual({ client_ip: ip })
  })

  it.each([{}, null, { client_ip: 42 }])('requires a string client_ip: %j', (response) => {
    expect(
      zGetWorkspacesCurrentNetworkAccessGroupsCurrentIpResponse.safeParse(response).success,
    ).toBe(false)
  })

  it('retains the existing saved-group preflight contract', () => {
    const schema = zGetWorkspacesCurrentNetworkAccessGroupsByGroupIdCheckCurrentIpResponse
    expect(schema.parse({ client_ip: '192.0.2.1', allowed: false, policy_version: 1 })).toEqual({
      client_ip: '192.0.2.1',
      allowed: false,
      policy_version: 1,
    })
    expect(schema.safeParse({ client_ip: '192.0.2.1' }).success).toBe(false)
    expect(
      zGetWorkspacesCurrentNetworkAccessGroupsByGroupIdCheckCurrentIpPath.safeParse({}).success,
    ).toBe(false)
  })
})
