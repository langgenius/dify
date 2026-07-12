import { buildIntegrationPath } from '@/app/components/integrations/routes'

type MainNavRouteVisibility = 'all' | 'notDatasetOperator' | 'appDeployEditor'

const DATASET_COLLECTION_ROUTES = new Set(['create', 'create-from-pipeline', 'connect'])
const DATASET_DOCUMENT_CREATION_ROUTES = new Set(['create', 'create-from-pipeline'])
const DEPLOYMENT_COLLECTION_ROUTES = new Set(['create'])

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
  canUseAppDeploy: boolean
  isCurrentWorkspaceDatasetOperator: boolean
  marketplaceEnabled: boolean
}

export type DetailSidebarVisibilityOptions = Pick<
  MainNavRouteVisibilityOptions,
  'agentV2Enabled' | 'canUseAppDeploy' | 'isCurrentWorkspaceDatasetOperator'
>

function isPathUnderRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`)
}

export const MAIN_NAV_ROUTES = [
  {
    key: 'home',
    href: '/',
    labelKey: 'mainNav.home',
    active: (path: string) => path === '/' || path === '/explore/apps',
    icon: 'i-custom-vender-main-nav-home',
    activeIcon: 'i-custom-vender-main-nav-home-active',
    visibility: 'all',
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
    visibility: 'all',
  },
  {
    key: 'roster',
    href: '/agents',
    label: 'Agents',
    active: (path: string) => isPathUnderRoute(path, '/agents'),
    icon: 'i-custom-vender-main-nav-roster',
    activeIcon: 'i-custom-vender-main-nav-roster-active',
    visibility: 'notDatasetOperator',
    feature: 'agentV2',
  },
  {
    key: 'datasets',
    href: '/datasets',
    labelKey: 'menus.datasets',
    active: (path: string) => isPathUnderRoute(path, '/datasets'),
    icon: 'i-custom-vender-main-nav-knowledge',
    activeIcon: 'i-custom-vender-main-nav-knowledge-active',
    visibility: 'all',
  },
  {
    key: 'integrations',
    href: buildIntegrationPath('provider'),
    labelKey: 'mainNav.integrations',
    active: (path: string) =>
      isPathUnderRoute(path, '/integrations') || isPathUnderRoute(path, '/tools'),
    icon: 'i-custom-vender-main-nav-integrations',
    activeIcon: 'i-custom-vender-main-nav-integrations-active',
    visibility: 'all',
  },
  {
    key: 'marketplace',
    href: '/marketplace',
    labelKey: 'mainNav.marketplace',
    active: (path: string) =>
      isPathUnderRoute(path, '/marketplace') || isPathUnderRoute(path, '/plugins'),
    icon: 'i-custom-vender-main-nav-marketplace',
    activeIcon: 'i-custom-vender-main-nav-marketplace-active',
    visibility: 'all',
    feature: 'marketplace',
  },
  {
    key: 'deployments',
    href: '/deployments',
    labelKey: 'menus.deployments',
    active: (path: string) => isPathUnderRoute(path, '/deployments'),
    icon: 'i-ri-rocket-line',
    activeIcon: 'i-ri-rocket-fill',
    visibility: 'appDeployEditor',
  },
] as const satisfies readonly MainNavRouteConfig[]

export function isMainNavRouteVisible(
  route: MainNavRouteConfig,
  options: MainNavRouteVisibilityOptions,
) {
  if (route.feature === 'agentV2' && !options.agentV2Enabled) return false

  if (route.feature === 'marketplace' && !options.marketplaceEnabled) return false

  if (route.visibility === 'all') return true

  if (route.visibility === 'notDatasetOperator') return !options.isCurrentWorkspaceDatasetOperator

  return options.canUseAppDeploy
}

function isAppDetailPathname(pathname: string) {
  return pathname.startsWith('/app/')
}

function isDatasetDetailPathname(pathname: string) {
  const [section, datasetId, subSection, action] = pathname.split('/').filter(Boolean)

  if (section !== 'datasets' || !datasetId) return false

  if (DATASET_COLLECTION_ROUTES.has(datasetId)) return false

  if (subSection === 'documents' && action && DATASET_DOCUMENT_CREATION_ROUTES.has(action))
    return false

  return true
}

function isAgentDetailPathname(pathname: string) {
  const [section, agentId] = pathname.split('/').filter(Boolean)

  return section === 'agents' && !!agentId
}

function isDeploymentDetailPathname(pathname: string) {
  const [section, appInstanceId] = pathname.split('/').filter(Boolean)

  return (
    section === 'deployments' && !!appInstanceId && !DEPLOYMENT_COLLECTION_ROUTES.has(appInstanceId)
  )
}

function isSnippetDetailPathname(pathname: string) {
  const [section, snippetId] = pathname.split('/').filter(Boolean)

  return section === 'snippets' && !!snippetId
}

export function shouldUseDetailSidebar(pathname: string, options: DetailSidebarVisibilityOptions) {
  if (isDatasetDetailPathname(pathname) || isSnippetDetailPathname(pathname)) return true

  if (options.isCurrentWorkspaceDatasetOperator) return false

  if (isAppDetailPathname(pathname)) return true

  if (options.agentV2Enabled && isAgentDetailPathname(pathname)) return true

  return options.canUseAppDeploy && isDeploymentDetailPathname(pathname)
}
