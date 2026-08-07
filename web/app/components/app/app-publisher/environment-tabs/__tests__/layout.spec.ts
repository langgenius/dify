import { getEnvironmentTabLayout } from '../layout'

const environmentTabWidths = {
  canary: 72,
  preview: 80,
  production: 88,
}

describe('getEnvironmentTabLayout', () => {
  it('shows every joined environment without a More trigger when the row fits', () => {
    expect(
      getEnvironmentTabLayout({
        availableWidth: 320,
        builtInWidth: 64,
        environmentTabWidths,
        hasUndeployedEnvironments: false,
        joinedEnvironmentIds: ['canary', 'preview'],
        moreEnvironmentsWidth: 120,
        moreWidth: 64,
      }),
    ).toEqual({
      overflowEnvironmentIds: [],
      showMore: false,
      visibleEnvironmentIds: ['canary', 'preview'],
    })
  })

  it('reserves room for adding undeployed environments', () => {
    expect(
      getEnvironmentTabLayout({
        availableWidth: 240,
        builtInWidth: 64,
        environmentTabWidths,
        hasUndeployedEnvironments: true,
        joinedEnvironmentIds: ['canary', 'preview'],
        moreEnvironmentsWidth: 120,
        moreWidth: 64,
      }),
    ).toEqual({
      overflowEnvironmentIds: ['preview'],
      showMore: true,
      visibleEnvironmentIds: ['canary'],
    })
  })

  it('keeps overflow environments in their joined order', () => {
    expect(
      getEnvironmentTabLayout({
        availableWidth: 250,
        builtInWidth: 64,
        environmentTabWidths,
        hasUndeployedEnvironments: false,
        joinedEnvironmentIds: ['canary', 'preview', 'production'],
        moreEnvironmentsWidth: 120,
        moreWidth: 64,
      }),
    ).toEqual({
      overflowEnvironmentIds: ['preview', 'production'],
      showMore: true,
      visibleEnvironmentIds: ['canary'],
    })
  })

  it('shows only the add trigger when no environment has joined', () => {
    expect(
      getEnvironmentTabLayout({
        availableWidth: 320,
        builtInWidth: 64,
        environmentTabWidths,
        hasUndeployedEnvironments: true,
        joinedEnvironmentIds: [],
        moreEnvironmentsWidth: 120,
        moreWidth: 64,
      }),
    ).toEqual({
      overflowEnvironmentIds: [],
      showMore: true,
      visibleEnvironmentIds: [],
    })
  })
})
