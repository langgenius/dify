export const INTEGRATION_SECTION_VALUES = [
  'provider',
  'builtin',
  'mcp',
  'custom-tool',
  'workflow-tool',
  'data-source',
  'api-based-extension',
  'trigger',
  'agent-strategy',
  'extension',
] as const

export type IntegrationSection = typeof INTEGRATION_SECTION_VALUES[number]

export const TOOL_CATEGORY_VALUES = ['builtin', 'api', 'workflow', 'mcp'] as const
export type ToolCategory = typeof TOOL_CATEGORY_VALUES[number]

export type LegacyToolsSearchParams = Record<string, string | string[] | undefined>

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

export const integrationPathBySection: Record<IntegrationSection, string> = {
  'provider': '/integrations/model-provider',
  'builtin': '/integrations/tools/built-in',
  'custom-tool': '/integrations/tool/api',
  'workflow-tool': '/integrations/tools/workflow',
  'mcp': '/integrations/tools/mcp',
  'data-source': '/integrations/data-source',
  'api-based-extension': '/integrations/tools/api-extension',
  'trigger': '/integrations/trigger',
  'agent-strategy': '/integrations/agent-strategy',
  'extension': '/integrations/extension',
}

export const buildIntegrationPath = (section: IntegrationSection) => {
  return integrationPathBySection[section]
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

export const getIntegrationRouteTargetBySlug = (slug?: string[]): IntegrationRouteTarget => {
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
      return { type: 'section', section: 'custom-tool' }
    case 'tools/workflow':
      return { type: 'section', section: 'workflow-tool' }
    case 'tools/mcp':
      return { type: 'section', section: 'mcp' }
    case 'data-source':
      return { type: 'section', section: 'data-source' }
    case 'tools/api-extension':
      return { type: 'section', section: 'api-based-extension' }
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
