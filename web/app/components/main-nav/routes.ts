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
  isCurrentWorkspaceDatasetOperator: boolean
  marketplaceEnabled: boolean
}

export type DetailSidebarVisibilityOptions = Pick<
  MainNavRouteVisibilityOptions,
  'agentV2Enabled' | 'isCurrentWorkspaceDatasetOperator'
>

const VISIBLE_TO_ALL: MainNavRouteVisibility = () => true
const CAN_MANAGE_AGENTS: MainNavRouteVisibility = (options) => options.canManageAgents

function isPathUnderRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`)
}

export const MAIN_NAV_ROUTES = [
  {
    key: 'home',
    href: '/',
    labelKey: 'mainNav.home',
    active: (path: string) => path === '/',
    icon: 'i-custom-vender-main-nav-home',
    activeIcon: 'i-custom-vender-main-nav-home-active',
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
    icon: 'i-custom-vender-main-nav-studio',
    activeIcon: 'i-custom-vender-main-nav-studio-active',
    visibility: VISIBLE_TO_ALL,
  },
  {
    key: 'roster',
    href: '/agents',
    label: 'Agents',
    active: (path: string) => isPathUnderRoute(path, '/agents'),
    icon: 'i-custom-vender-main-nav-roster',
    activeIcon: 'i-custom-vender-main-nav-roster-active',
    visibility: CAN_MANAGE_AGENTS,
    feature: 'agentV2',
  },
  {
    key: 'datasets',
    href: '/datasets',
    labelKey: 'menus.datasets',
    active: (path: string) => isPathUnderRoute(path, '/datasets'),
    icon: 'i-custom-vender-main-nav-knowledge',
    activeIcon: 'i-custom-vender-main-nav-knowledge-active',
    visibility: VISIBLE_TO_ALL,
  },
  {
    key: 'integrations',
    href: buildIntegrationPath('provider'),
    labelKey: 'mainNav.integrations',
    active: (path: string) =>
      isPathUnderRoute(path, '/integrations') || isPathUnderRoute(path, '/tools'),
    icon: 'i-custom-vender-main-nav-integrations',
    activeIcon: 'i-custom-vender-main-nav-integrations-active',
    visibility: VISIBLE_TO_ALL,
  },
  {
    key: 'marketplace',
    href: '/marketplace',
    labelKey: 'mainNav.marketplace',
    active: (path: string) =>
      isPathUnderRoute(path, '/marketplace') || isPathUnderRoute(path, '/plugins'),
    icon: 'i-custom-vender-main-nav-marketplace',
    activeIcon: 'i-custom-vender-main-nav-marketplace-active',
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

export function shouldHideMainNavigation(pathname: string) {
  const [section, namespace, knowledgeSpaceId] = pathname.split('/').filter(Boolean)

  return (
    section === 'datasets' &&
    namespace === 'new' &&
    !!knowledgeSpaceId &&
    knowledgeSpaceId !== 'create'
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
