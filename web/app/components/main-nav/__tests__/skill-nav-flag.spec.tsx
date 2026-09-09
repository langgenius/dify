import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vite-plus/test'
import { isMainNavRouteVisible, MAIN_NAV_ROUTES } from '@/app/components/main-nav/routes'
import { useProviderContextSelector } from '@/context/provider-context'
import { ProviderContextProvider } from '@/context/provider-context-provider'
import { createConsoleQueryWrapper, seedFeatures } from '@/test/console/query-data'

vi.mock('@/service/use-common', () => ({
  commonQueryKeys: { modelProviderDetails: ['common', 'model-provider-details'] },
  useModelListByType: () => ({ data: { data: [] } }),
  useSupportRetrievalMethods: () => ({ data: { retrieval_method: [] } }),
}))

function getSkillsRoute() {
  const route = MAIN_NAV_ROUTES.find((item) => item.key === 'skills')
  if (!route) throw new Error('Skills main-nav route is missing')
  return route
}

const skillsRoute = getSkillsRoute()

const skillNavVisibility = {
  agentV2Enabled: true,
  canManageAgents: true,
  canViewSkills: true,
  isCurrentWorkspaceDatasetOperator: false,
  marketplaceEnabled: true,
}

function SkillNavRow() {
  const enableSkill = useProviderContextSelector((state) => state.enableSkill)
  return isMainNavRouteVisible(skillsRoute, {
    ...skillNavVisibility,
    skillEnabled: enableSkill,
  }) ? (
    <a href={skillsRoute.href}>Skills</a>
  ) : null
}

function renderRequest(enableSkill?: boolean) {
  const { queryClient, wrapper: Wrapper } = createConsoleQueryWrapper()
  if (enableSkill !== undefined) seedFeatures(queryClient, { enable_skill: enableSkill })
  try {
    return renderToString(
      <Wrapper>
        <ProviderContextProvider>
          <SkillNavRow />
        </ProviderContextProvider>
      </Wrapper>,
    )
  } finally {
    queryClient.clear()
  }
}

describe('Skills nav server rendering', () => {
  it('does not reuse another request’s enabled flag when features are unavailable', () => {
    expect(renderRequest(true)).toContain('Skills')
    expect(renderRequest()).not.toContain('Skills')
  })

  it('uses each request’s disabled flag', () => {
    expect(renderRequest(true)).toContain('Skills')
    expect(renderRequest(false)).not.toContain('Skills')
  })
})
