import { buildIntegrationPath } from '@/app/components/integrations/routes'

type MainNavRouteVisibility = (options: MainNavRouteVisibilityOptions) => boolean

const DATASET_COLLECTION_ROUTES = new Set(['create', 'create-from-pipeline', 'connect'])
const DATASET_DOCUMENT_CREATION_ROUTES = new Set(['create', 'create-from-pipeline'])

export type MainNavRouteConfig = {
  key: string
  href: string
  active: (pathname: string) => boolean
  icon: string
  activeIcon: string
  visibility: MainNavRouteVisibility
  feature?: 'agentV2' | 'marketplace'
} & ({ label: string; labelKey?: never } | { label?: never; labelKey: string })

export type MainNavRouteVisibilityOptions = {
  agentV2Enabled: boolean
  canManageAgents: boolean
  canViewSkills: boolean
  isCurrentWorkspaceDatasetOperator: boolean
  marketplaceEnabled: boolean
  skillEnabled: boolean
}

export type DetailSidebarVisibilityOptions = Pick<
  MainNavRouteVisibilityOptions,
  'agentV2Enabled' | 'isCurrentWorkspaceDatasetOperator'
>

const VISIBLE_TO_ALL: MainNavRouteVisibility = () => true
const CAN_MANAGE_AGENTS: MainNavRouteVisibility = (options) => options.canManageAgents
const SKILL_ENABLED_FOR_WORKSPACE: MainNavRouteVisibility = (options) =>
  options.skillEnabled && options.canViewSkills && !options.isCurrentWorkspaceDatasetOperator

function isPathUnderRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`)
}

export const MAIN_NAV_ROUTES = [
  {
    key: 'home',
    href: '/',
    labelKey: 'mainNav.home',
    active: (path: string) => path === '/' || path === '/explore/apps',
    icon: 'i-custom-vender-main-nav-home-v2',
    activeIcon: 'i-custom-vender-main-nav-home-v2-active',
    visibility: VISIBLE_TO_ALL,
  },
  {
    key: 'apps',
    href: '/apps',
    labelKey: 'menus.apps',
    active: (path: string) =>
      isPathUnderRoute(path, '/apps') ||
      isPathUnderRoute(path, '/app') ||
      isPathUnderRoute(path, '/snippets'),
    icon: 'i-custom-vender-main-nav-studio-v2',
    activeIcon: 'i-custom-vender-main-nav-studio-v2-active',
    visibility: VISIBLE_TO_ALL,
  },
  {
    key: 'roster',
    href: '/agents',
    label: 'Agents',
    active: (path: string) => isPathUnderRoute(path, '/agents'),
    icon: 'i-custom-vender-main-nav-agent',
    activeIcon: 'i-custom-vender-main-nav-agent-active',
    visibility: CAN_MANAGE_AGENTS,
    feature: 'agentV2',
  },
  {
    key: 'skills',
    href: '/skills',
    labelKey: 'mainNav.skills',
    active: (path: string) => isPathUnderRoute(path, '/skills'),
    icon: 'i-custom-vender-main-nav-skill',
    activeIcon: 'i-custom-vender-main-nav-skill-active',
    visibility: SKILL_ENABLED_FOR_WORKSPACE,
  },
  {
    key: 'datasets',
    href: '/datasets',
    labelKey: 'menus.datasets',
    active: (path: string) => isPathUnderRoute(path, '/datasets'),
    icon: 'i-custom-vender-main-nav-knowledge-v2',
    activeIcon: 'i-custom-vender-main-nav-knowledge-v2-active',
    visibility: VISIBLE_TO_ALL,
  },
  {
    key: 'integrations',
    href: buildIntegrationPath('provider'),
    labelKey: 'mainNav.integrations',
    active: (path: string) =>
      isPathUnderRoute(path, '/integrations') || isPathUnderRoute(path, '/tools'),
    icon: 'i-custom-vender-main-nav-integrations-v2',
    activeIcon: 'i-custom-vender-main-nav-integrations-v2-active',
    visibility: VISIBLE_TO_ALL,
  },
  {
    key: 'marketplace',
    href: '/marketplace',
    labelKey: 'mainNav.marketplace',
    active: (path: string) =>
      isPathUnderRoute(path, '/marketplace') ||
      isPathUnderRoute(path, '/plugins') ||
      isPathUnderRoute(path, '/templates'),
    icon: 'i-custom-vender-main-nav-marketplace-v2',
    activeIcon: 'i-custom-vender-main-nav-marketplace-v2-active',
    visibility: VISIBLE_TO_ALL,
    feature: 'marketplace',
  },
] as const satisfies readonly MainNavRouteConfig[]

export function isMainNavRouteVisible(
  route: MainNavRouteConfig,
  options: MainNavRouteVisibilityOptions,
) {
  if (route.feature === 'agentV2' && !options.agentV2Enabled) return false

  if (route.feature === 'marketplace' && !options.marketplaceEnabled) return false

  return route.visibility(options)
}

function isAppDetailPathname(pathname: string) {
  return pathname.startsWith('/app/')
}

function isDatasetDetailPathname(pathname: string) {
  const [section, datasetId, subSection, action] = pathname.split('/').filter(Boolean)

  if (section !== 'datasets' || !datasetId) return false

  if (DATASET_COLLECTION_ROUTES.has(datasetId)) return false

  if (datasetId === 'new' && subSection === 'create') return false

  if (subSection === 'documents' && action && DATASET_DOCUMENT_CREATION_ROUTES.has(action))
    return false

  return true
}

function isSkillDetailPathname(pathname: string) {
  const [section, skillId] = pathname.split('/').filter(Boolean)

  return section === 'skills' && !!skillId
}

export function shouldHideMainNavigation(pathname: string) {
  const [section, namespace, knowledgeSpaceId] = pathname.split('/').filter(Boolean)

  return (
    (section === 'datasets' &&
      namespace === 'new' &&
      !!knowledgeSpaceId &&
      knowledgeSpaceId !== 'create') ||
    isSkillDetailPathname(pathname)
  )
}

function isAgentDetailPathname(pathname: string) {
  const [section, agentId] = pathname.split('/').filter(Boolean)

  return section === 'agents' && !!agentId
}

function isSnippetDetailPathname(pathname: string) {
  const [section, snippetId] = pathname.split('/').filter(Boolean)

  return section === 'snippets' && !!snippetId
}

export function shouldUseDetailSidebar(pathname: string, options: DetailSidebarVisibilityOptions) {
  if (isDatasetDetailPathname(pathname) || isSnippetDetailPathname(pathname)) return true

  if (options.isCurrentWorkspaceDatasetOperator) return false

  if (isAppDetailPathname(pathname)) return true

  return options.agentV2Enabled && isAgentDetailPathname(pathname)
}
