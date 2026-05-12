import {
  buildIntegrationPath,
  getIntegrationRedirectPathByLegacyToolsSearchParams,
  getIntegrationRouteTargetBySlug,
  integrationPathBySection,
} from '../integration-routes'

describe('integration routes', () => {
  it('maps integration sections to canonical paths', () => {
    expect(integrationPathBySection).toEqual({
      'provider': '/integrations/model-provider',
      'builtin': '/integrations/tools/built-in',
      'custom-tool': '/integrations/tools/swagger-api',
      'workflow-tool': '/integrations/tools/workflow',
      'mcp': '/integrations/tools/mcp',
      'data-source': '/integrations/data-source',
      'api-based-extension': '/integrations/tools/api-extension',
      'trigger': '/integrations/trigger',
      'agent-strategy': '/integrations/agent-strategy',
      'extension': '/integrations/extension',
    })
    expect(buildIntegrationPath('custom-tool')).toBe('/integrations/tools/swagger-api')
  })

  it.each([
    [undefined, { type: 'redirect', destination: '/integrations/model-provider' }],
    [[], { type: 'redirect', destination: '/integrations/model-provider' }],
    [['model-provider'], { type: 'section', section: 'provider' }],
    [['tools'], { type: 'redirect', destination: '/integrations/tools/built-in' }],
    [['tools', 'built-in'], { type: 'section', section: 'builtin' }],
    [['tools', 'swagger-api'], { type: 'section', section: 'custom-tool' }],
    [['tools', 'workflow'], { type: 'section', section: 'workflow-tool' }],
    [['tools', 'mcp'], { type: 'section', section: 'mcp' }],
    [['data-source'], { type: 'section', section: 'data-source' }],
    [['tools', 'api-extension'], { type: 'section', section: 'api-based-extension' }],
    [['trigger'], { type: 'section', section: 'trigger' }],
    [['agent-strategy'], { type: 'section', section: 'agent-strategy' }],
    [['extension'], { type: 'section', section: 'extension' }],
    [['model-providers'], { type: 'not-found' }],
    [['data-sources'], { type: 'not-found' }],
    [['api-extensions'], { type: 'not-found' }],
    [['tools', 'trigger'], { type: 'not-found' }],
    [['tools', 'agent-strategy'], { type: 'not-found' }],
    [['tools', 'extension'], { type: 'not-found' }],
    [['missing'], { type: 'not-found' }],
  ])('resolves slug %j', (slug, expected) => {
    expect(getIntegrationRouteTargetBySlug(slug)).toEqual(expected)
  })

  it.each([
    [{}, '/integrations/tools/built-in'],
    [{ section: 'provider' }, '/integrations/model-provider'],
    [{ section: 'builtin' }, '/integrations/tools/built-in'],
    [{ category: 'builtin' }, '/integrations/tools/built-in'],
    [{ category: 'api' }, '/integrations/tools/swagger-api'],
    [{ category: 'workflow' }, '/integrations/tools/workflow'],
    [{ category: 'mcp' }, '/integrations/tools/mcp'],
    [{ section: 'data-source' }, '/integrations/data-source'],
    [{ section: 'api-based-extension' }, '/integrations/tools/api-extension'],
    [{ section: 'custom-tool', category: 'api', q: 'slack', tags: ['a', 'b'] }, '/integrations/tools/swagger-api?q=slack&tags=a&tags=b'],
  ])('builds legacy /tools redirect for search params %j', (searchParams, expected) => {
    expect(getIntegrationRedirectPathByLegacyToolsSearchParams(searchParams)).toBe(expected)
  })
})
