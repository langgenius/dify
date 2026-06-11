export const INTEGRATION_SECTION_VALUES = [
  'provider',
  'builtin',
  'mcp',
  'custom-tool',
  'workflow-tool',
  'data-source',
  'custom-endpoint',
  'trigger',
  'agent-strategy',
  'extension',
] as const

export type IntegrationSection = typeof INTEGRATION_SECTION_VALUES[number]

export const TOOL_CATEGORY_VALUES = ['builtin', 'api', 'workflow', 'mcp'] as const
export type ToolCategory = typeof TOOL_CATEGORY_VALUES[number]

export type LegacyToolsSearchParams = Record<string, string | string[] | undefined>
export type IntegrationRouteSearchParams = Record<string, string | string[] | undefined>

const integrationSectionSet = new Set<string>(INTEGRATION_SECTION_VALUES)
const toolCategorySet = new Set<string>(TOOL_CATEGORY_VALUES)

const isIntegrationSection = (value: string): value is IntegrationSection => {
  return integrationSectionSet.has(value)
}

const isToolCategory = (value: string): value is ToolCategory => {
  return toolCategorySet.has(value)
}

const getFirstSearchParamValue = (value: string | string[] | undefined) => {
  if (Array.isArray(value))
    return value[0]

  return value
}

const appendSearchParams = (path: string, searchParams: IntegrationRouteSearchParams = {}) => {
  const params = new URLSearchParams()

  Object.entries(searchParams).forEach(([key, value]) => {
    if (value === undefined)
      return

    if (Array.isArray(value)) {
      value.forEach(item => params.append(key, item))
      return
    }

    params.set(key, value)
  })

  const query = params.toString()
  return query ? `${path}?${query}` : path
}

export const toolCategoryBySection: Partial<Record<IntegrationSection, ToolCategory>> = {
  'builtin': 'builtin',
  'mcp': 'mcp',
  'custom-tool': 'api',
  'workflow-tool': 'workflow',
}

export const sectionByToolCategory: Record<ToolCategory, IntegrationSection> = {
  builtin: 'builtin',
  api: 'custom-tool',
  workflow: 'workflow-tool',
  mcp: 'mcp',
}

export const marketplaceCategoryByIntegrationSection: Partial<Record<IntegrationSection, string>> = {
  'provider': 'model',
  'builtin': 'tool',
  'mcp': 'tool',
  'custom-tool': 'tool',
  'workflow-tool': 'tool',
  'data-source': 'datasource',
  'custom-endpoint': 'extension',
  'trigger': 'trigger',
  'agent-strategy': 'agent-strategy',
  'extension': 'extension',
}

export const marketplaceUrlPathByIntegrationSection: Partial<Record<IntegrationSection, string>> = {
  'provider': '/plugins/model',
  'builtin': '/plugins/tool',
  'mcp': '/plugins/tool',
  'custom-tool': '/plugins/tool',
  'workflow-tool': '/plugins/tool',
  'data-source': '/plugins/datasource',
  'custom-endpoint': '/plugins/extension',
  'trigger': '/plugins/trigger',
  'agent-strategy': '/plugins/agent-strategy',
  'extension': '/plugins/extension',
}

export const integrationPathBySection: Record<IntegrationSection, string> = {
  'provider': '/integrations/model-provider',
  'builtin': '/integrations/tools/built-in',
  'custom-tool': '/integrations/tools/api',
  'workflow-tool': '/integrations/tools/workflow',
  'mcp': '/integrations/tools/mcp',
  'data-source': '/integrations/data-source',
  'custom-endpoint': '/integrations/custom-endpoint',
  'trigger': '/integrations/trigger',
  'agent-strategy': '/integrations/agent-strategy',
  'extension': '/integrations/extension',
}

export const buildIntegrationPath = (section: IntegrationSection) => {
  return integrationPathBySection[section]
}

export const buildMarketplacePathByIntegrationSection = (section: IntegrationSection) => {
  const category = marketplaceCategoryByIntegrationSection[section]

  if (!category)
    return '/marketplace'

  const params = new URLSearchParams({ category })
  return `/marketplace?${params.toString()}`
}

export const buildMarketplaceUrlPathByIntegrationSection = (section: IntegrationSection) => {
  return marketplaceUrlPathByIntegrationSection[section] ?? '/plugins'
}

export const getIntegrationRedirectPathByLegacyToolsSearchParams = (
  searchParams: LegacyToolsSearchParams = {},
) => {
  const sectionParam = getFirstSearchParamValue(searchParams.section)
  const categoryParam = getFirstSearchParamValue(searchParams.category)
  const section = sectionParam && isIntegrationSection(sectionParam)
    ? sectionParam
    : categoryParam && isToolCategory(categoryParam)
      ? sectionByToolCategory[categoryParam]
      : 'builtin'

  const preservedSearchParams = new URLSearchParams()
  Object.entries(searchParams).forEach(([key, value]) => {
    if (key === 'section' || key === 'category' || value === undefined)
      return

    if (Array.isArray(value)) {
      value.forEach(item => preservedSearchParams.append(key, item))
      return
    }

    preservedSearchParams.set(key, value)
  })

  const query = preservedSearchParams.toString()
  return query ? `${buildIntegrationPath(section)}?${query}` : buildIntegrationPath(section)
}

type IntegrationRouteTarget
  = | { type: 'redirect', destination: string }
    | { type: 'section', section: IntegrationSection }
    | { type: 'not-found' }

export const getIntegrationRouteTargetBySlug = (slug?: string[], searchParams?: IntegrationRouteSearchParams): IntegrationRouteTarget => {
  const path = slug?.join('/') ?? ''

  switch (path) {
    case '':
      return { type: 'redirect', destination: buildIntegrationPath('provider') }
    case 'model-provider':
      return { type: 'section', section: 'provider' }
    case 'tools':
      return { type: 'redirect', destination: buildIntegrationPath('builtin') }
    case 'tools/built-in':
      return { type: 'section', section: 'builtin' }
    case 'tool/api':
      return { type: 'redirect', destination: appendSearchParams(buildIntegrationPath('custom-tool'), searchParams) }
    case 'tools/api':
      return { type: 'section', section: 'custom-tool' }
    case 'tools/workflow':
      return { type: 'section', section: 'workflow-tool' }
    case 'tools/mcp':
      return { type: 'section', section: 'mcp' }
    case 'data-source':
      return { type: 'section', section: 'data-source' }
    case 'custom-endpoint':
      return { type: 'section', section: 'custom-endpoint' }
    case 'trigger':
      return { type: 'section', section: 'trigger' }
    case 'agent-strategy':
      return { type: 'section', section: 'agent-strategy' }
    case 'extension':
      return { type: 'section', section: 'extension' }
    default:
      return { type: 'not-found' }
  }
}
