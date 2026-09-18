import type { Namespace } from './resources'
import { defaultNS, namespaces } from './resources'

export const shellNamespaces = [
  'common',
  'app',
  'layout',
  'time',
] as const satisfies readonly Namespace[]

type RouteNamespaceRule = {
  match: (pathname: string) => boolean
  namespaces: readonly Namespace[]
}

const isPathUnder = (pathname: string, route: string) =>
  pathname === route || pathname.startsWith(`${route}/`)

const ROUTE_NAMESPACE_RULES: RouteNamespaceRule[] = [
  {
    match: (pathname) => isPathUnder(pathname, '/signin') || isPathUnder(pathname, '/signup'),
    namespaces: ['login', 'register', 'oauth', 'explore'],
  },
  {
    match: (pathname) =>
      isPathUnder(pathname, '/reset-password') || isPathUnder(pathname, '/install'),
    namespaces: ['login', 'register'],
  },
  {
    match: (pathname) => isPathUnder(pathname, '/device'),
    namespaces: ['deviceFlow'],
  },
  {
    match: (pathname) => isPathUnder(pathname, '/education'),
    namespaces: ['education'],
  },
  {
    match: (pathname) =>
      pathname === '/' || isPathUnder(pathname, '/explore') || isPathUnder(pathname, '/apps'),
    namespaces: ['explore'],
  },
  {
    match: (pathname) => isPathUnder(pathname, '/datasets'),
    namespaces: [
      'dataset',
      'datasetCreation',
      'datasetDocuments',
      'datasetHitTesting',
      'datasetPipeline',
      'datasetSettings',
    ],
  },
  {
    match: (pathname) => isPathUnder(pathname, '/agents'),
    namespaces: ['agentV2', 'appOverview', 'workflow', 'skill', 'custom'],
  },
  {
    match: (pathname) => isPathUnder(pathname, '/skills'),
    namespaces: ['skill', 'workflow'],
  },
  {
    match: (pathname) =>
      isPathUnder(pathname, '/marketplace') ||
      isPathUnder(pathname, '/plugins') ||
      isPathUnder(pathname, '/templates'),
    namespaces: ['plugin', 'pluginTags', 'pluginTrigger', 'explore'],
  },
  {
    match: (pathname) => isPathUnder(pathname, '/integrations') || isPathUnder(pathname, '/tools'),
    namespaces: ['tools', 'plugin', 'pluginTags', 'pluginTrigger'],
  },
  {
    match: (pathname) => isPathUnder(pathname, '/app') || isPathUnder(pathname, '/snippets'),
    namespaces: [
      'agentV2',
      'appDebug',
      'appOverview',
      'appApi',
      'appAnnotation',
      'appLog',
      'workflow',
      'tools',
      'plugin',
      'pluginTags',
      'pluginTrigger',
      'runLog',
      'pipeline',
      'deployments',
      'custom',
      'billing',
      'snippet',
    ],
  },
  {
    match: (pathname) => {
      const [section] = pathname.split('/').filter(Boolean)
      return (
        section === 'chat' ||
        section === 'chatbot' ||
        section === 'workflow' ||
        section === 'completion' ||
        section === 'agent' ||
        section === 'environment' ||
        isPathUnder(pathname, '/webapp-signin') ||
        isPathUnder(pathname, '/webapp-reset-password')
      )
    },
    namespaces: ['share', 'workflow', 'runLog', 'appDebug'],
  },
  {
    match: (pathname) => isPathUnder(pathname, '/account'),
    namespaces: ['billing', 'permission', 'permissionKeys'],
  },
]

function resolveRouteNamespaces(pathname: string): Namespace[] {
  const matched: Namespace[] = []

  for (const rule of ROUTE_NAMESPACE_RULES) {
    if (!rule.match(pathname)) continue
    matched.push(...rule.namespaces)
  }

  return matched
}

export function getInitialNamespacesForPath(pathname: string): Namespace[] {
  const merged = new Set<Namespace>([
    defaultNS,
    ...shellNamespaces,
    ...resolveRouteNamespaces(pathname),
  ])
  return namespaces.filter((ns) => merged.has(ns))
}
