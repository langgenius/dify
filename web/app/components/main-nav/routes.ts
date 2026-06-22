import { buildIntegrationPath } from '@/app/components/integrations/routes'

type MainNavRouteVisibility = 'all' | 'notDatasetOperator' | 'appDeployEditor'

export type MainNavRouteConfig = {
  key: string
  href: string
  labelKey: string
  active: (pathname: string) => boolean
  icon: string
  activeIcon: string
  visibility: MainNavRouteVisibility
  feature?: 'agentV2'
}

export type MainNavRouteVisibilityOptions = {
  agentV2Enabled: boolean
  canUseAppDeploy: boolean
  isCurrentWorkspaceDatasetOperator: boolean
}

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
    active: (path: string) => isPathUnderRoute(path, '/apps') || isPathUnderRoute(path, '/app') || isPathUnderRoute(path, '/snippets'),
    icon: 'i-custom-vender-main-nav-studio',
    activeIcon: 'i-custom-vender-main-nav-studio-active',
    visibility: 'all',
  },
  {
    key: 'roster',
    href: '/roster',
    labelKey: 'menus.roster',
    active: (path: string) => isPathUnderRoute(path, '/roster'),
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
    active: (path: string) => isPathUnderRoute(path, '/integrations') || isPathUnderRoute(path, '/tools'),
    icon: 'i-custom-vender-main-nav-integrations',
    activeIcon: 'i-custom-vender-main-nav-integrations-active',
    visibility: 'all',
  },
  {
    key: 'marketplace',
    href: '/marketplace',
    labelKey: 'mainNav.marketplace',
    active: (path: string) => isPathUnderRoute(path, '/marketplace') || isPathUnderRoute(path, '/plugins'),
    icon: 'i-custom-vender-main-nav-marketplace',
    activeIcon: 'i-custom-vender-main-nav-marketplace-active',
    visibility: 'all',
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

export function isMainNavRouteVisible(route: MainNavRouteConfig, options: MainNavRouteVisibilityOptions) {
  if (route.feature === 'agentV2' && !options.agentV2Enabled)
    return false

  if (route.visibility === 'all')
    return true

  if (route.visibility === 'notDatasetOperator')
    return !options.isCurrentWorkspaceDatasetOperator

  return options.canUseAppDeploy
}
