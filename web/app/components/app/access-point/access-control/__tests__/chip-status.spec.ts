import { getAccessControlChipState, getInServiceCoverage } from '../chip-status'

const assignment = {
  policyId: 'internal-network',
  policyName: 'Internal Network',
  scopes: {
    webApp: true,
    serviceApi: true,
    mcp: true,
    trigger: true,
  },
  enabled: true,
}

describe('getInServiceCoverage', () => {
  it('counts selected access points against every configured access point', () => {
    expect(
      getInServiceCoverage({ webApp: true, serviceApi: true, mcp: false, trigger: true }),
    ).toEqual({ coveredCount: 3, inServiceCount: 4 })
  })
})

describe('getAccessControlChipState', () => {
  it('returns pro when the workspace is not entitled and has no assignment', () => {
    expect(
      getAccessControlChipState({
        entitled: false,
        assignment: null,
      }).kind,
    ).toBe('pro')
  })

  it('keeps the saved assignment visible when the workspace is not entitled', () => {
    expect(
      getAccessControlChipState({
        entitled: false,
        assignment,
      }).kind,
    ).toBe('on')
  })

  it('returns off when the app has never been configured', () => {
    expect(
      getAccessControlChipState({
        entitled: true,
        assignment: null,
      }),
    ).toEqual({ kind: 'off', coveredCount: 0, inServiceCount: 0 })
  })

  it('returns paused when a saved policy is not enforcing', () => {
    expect(
      getAccessControlChipState({
        entitled: true,
        assignment: { ...assignment, enabled: false },
      }),
    ).toEqual({
      kind: 'paused',
      policyName: 'Internal Network',
      coveredCount: 4,
      inServiceCount: 4,
    })
  })

  it('returns on when every access point is covered', () => {
    expect(
      getAccessControlChipState({
        entitled: true,
        assignment,
      }),
    ).toEqual({
      kind: 'on',
      policyName: 'Internal Network',
      coveredCount: 4,
      inServiceCount: 4,
    })
  })

  it('returns partial when some access points are excluded', () => {
    expect(
      getAccessControlChipState({
        entitled: true,
        assignment: {
          ...assignment,
          scopes: { ...assignment.scopes, mcp: false },
        },
      }),
    ).toEqual({
      kind: 'partial',
      policyName: 'Internal Network',
      coveredCount: 3,
      inServiceCount: 4,
    })
  })
})
