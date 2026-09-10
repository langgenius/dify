import { getAccessControlChipState, getInServiceCoverage } from '../chip-status'

const availability = {
  webApp: true,
  serviceApi: true,
  mcp: true,
  trigger: false,
}

const assignment = {
  policyId: 'internal-network',
  policyName: 'Internal Network',
  scopes: {
    webApp: true,
    serviceApi: true,
    mcp: true,
    trigger: false,
  },
  enabled: true,
}

describe('getInServiceCoverage', () => {
  it('ignores unavailable access points in the denominator', () => {
    expect(
      getInServiceCoverage(
        { webApp: true, serviceApi: true, mcp: false, trigger: true },
        availability,
      ),
    ).toEqual({ coveredCount: 2, inServiceCount: 3 })
  })
})

describe('getAccessControlChipState', () => {
  it('returns pro when the workspace is not entitled and has no assignment', () => {
    expect(
      getAccessControlChipState({
        entitled: false,
        assignment: null,
        availability,
      }).kind,
    ).toBe('pro')
  })

  it('keeps the saved assignment visible when the workspace is not entitled', () => {
    expect(
      getAccessControlChipState({
        entitled: false,
        assignment,
        availability,
      }).kind,
    ).toBe('on')
  })

  it('returns off when the app has never been configured', () => {
    expect(
      getAccessControlChipState({
        entitled: true,
        assignment: null,
        availability,
      }),
    ).toEqual({ kind: 'off', coveredCount: 0, inServiceCount: 0 })
  })

  it('returns paused when a saved policy is not enforcing', () => {
    expect(
      getAccessControlChipState({
        entitled: true,
        assignment: { ...assignment, enabled: false },
        availability,
      }),
    ).toEqual({
      kind: 'paused',
      policyName: 'Internal Network',
      coveredCount: 3,
      inServiceCount: 3,
    })
  })

  it('returns on when every in-service access point is covered', () => {
    expect(
      getAccessControlChipState({
        entitled: true,
        assignment,
        availability,
      }),
    ).toEqual({
      kind: 'on',
      policyName: 'Internal Network',
      coveredCount: 3,
      inServiceCount: 3,
    })
  })

  it('returns partial when some in-service access points are excluded', () => {
    expect(
      getAccessControlChipState({
        entitled: true,
        assignment: {
          ...assignment,
          scopes: { ...assignment.scopes, mcp: false },
        },
        availability,
      }),
    ).toEqual({
      kind: 'partial',
      policyName: 'Internal Network',
      coveredCount: 2,
      inServiceCount: 3,
    })
  })
})
