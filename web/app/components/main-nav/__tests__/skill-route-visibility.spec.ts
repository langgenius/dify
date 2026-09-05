import { describe, expect, it } from 'vite-plus/test'
import { isMainNavRouteVisible, MAIN_NAV_ROUTES } from '../routes'

function getSkillsRoute() {
  const route = MAIN_NAV_ROUTES.find((item) => item.key === 'skills')
  if (!route) throw new Error('Skills main-nav route is missing')
  return route
}

const skillsRoute = getSkillsRoute()

const visibility = {
  agentV2Enabled: true,
  canManageAgents: true,
  canViewSkills: true,
  isCurrentWorkspaceDatasetOperator: false,
  marketplaceEnabled: true,
}

describe('Skills main-nav visibility', () => {
  it('shows the Skills row only when the flag is known to be on', () => {
    expect(
      isMainNavRouteVisible(skillsRoute, {
        ...visibility,
        skillEnabled: true,
      }),
    ).toBe(true)
  })

  it('hides the Skills row when the flag is known to be off', () => {
    expect(
      isMainNavRouteVisible(skillsRoute, {
        ...visibility,
        skillEnabled: false,
      }),
    ).toBe(false)
  })

  it('omits the Skills row while the flag is unknown', () => {
    expect(
      isMainNavRouteVisible(skillsRoute, {
        ...visibility,
        skillEnabled: undefined,
      }),
    ).toBe(false)
  })
})
