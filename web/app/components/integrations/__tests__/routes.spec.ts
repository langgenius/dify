import {
  buildIntegrationPath,
  buildMarketplaceUrlPathByIntegrationSection,
  getIntegrationRedirectPathByLegacyToolsSearchParams,
  getIntegrationRouteTargetBySlug,
  integrationPathBySection,
  marketplaceUrlPathByIntegrationSection,
} from '../routes'

describe('integration routes', () => {
  it('maps integration sections to canonical paths', () => {
    expect(integrationPathBySection).toEqual({
      provider: '/integrations/model-provider',
      builtin: '/integrations/tools/built-in',
      'custom-tool': '/integrations/tools/api',
      'workflow-tool': '/integrations/tools/workflow',
      mcp: '/integrations/tools/mcp',
      'data-source': '/integrations/data-source',
      'custom-endpoint': '/integrations/custom-endpoint',
      trigger: '/integrations/trigger',
      'agent-strategy': '/integrations/agent-strategy',
      extension: '/integrations/extension',
    })
    expect(buildIntegrationPath('custom-tool')).toBe('/integrations/tools/api')
  })

  it('maps integration sections to marketplace platform paths', () => {
    expect(marketplaceUrlPathByIntegrationSection).toEqual({
      provider: '/plugins/model',
      builtin: '/plugins/tool',
      mcp: '/plugins/tool',
      'custom-tool': '/plugins/tool',
      'workflow-tool': '/plugins/tool',
      'data-source': '/plugins/datasource',
      'custom-endpoint': '/plugins/extension',
      trigger: '/plugins/trigger',
      'agent-strategy': '/plugins/agent-strategy',
      extension: '/plugins/extension',
    })
    expect(buildMarketplaceUrlPathByIntegrationSection('provider')).toBe('/plugins/model')
    expect(buildMarketplaceUrlPathByIntegrationSection('custom-tool')).toBe('/plugins/tool')
    expect(buildMarketplaceUrlPathByIntegrationSection('extension')).toBe('/plugins/extension')
  })

  it.each([
    [undefined, { type: 'redirect', destination: '/integrations/model-provider' }],
    [[], { type: 'redirect', destination: '/integrations/model-provider' }],
    [['model-provider'], { type: 'section', section: 'provider' }],
    [
      ['model-provider', 'plugins'],
      { type: 'redirect', destination: '/integrations/model-provider' },
    ],
    [['tools'], { type: 'redirect', destination: '/integrations/tools/built-in' }],
    [['tools', 'built-in'], { type: 'section', section: 'builtin' }],
    [['tool', 'api'], { type: 'redirect', destination: '/integrations/tools/api' }],
    [['tools', 'api'], { type: 'section', section: 'custom-tool' }],
    [['tools', 'workflow'], { type: 'section', section: 'workflow-tool' }],
    [['tools', 'mcp'], { type: 'section', section: 'mcp' }],
    [['data-source'], { type: 'section', section: 'data-source' }],
    [['custom-endpoint'], { type: 'section', section: 'custom-endpoint' }],
    [['trigger'], { type: 'section', section: 'trigger' }],
    [['agent-strategy'], { type: 'section', section: 'agent-strategy' }],
    [['extension'], { type: 'section', section: 'extension' }],
    [
      ['agent-strategy', 'plugins'],
      { type: 'redirect', destination: '/integrations/agent-strategy' },
    ],
    [['trigger', 'plugins'], { type: 'redirect', destination: '/integrations/trigger' }],
    [
      ['tools', 'built-in', 'plugins'],
      { type: 'redirect', destination: '/integrations/tools/built-in' },
    ],
    [['data-source', 'plugins'], { type: 'redirect', destination: '/integrations/data-source' }],
    [['model-providers'], { type: 'not-found' }],
    [['data-sources'], { type: 'not-found' }],
    [['api-extensions'], { type: 'not-found' }],
    [['tools', 'api-extension'], { type: 'not-found' }],
    [['tools', 'swagger-api'], { type: 'not-found' }],
    [['tools', 'trigger'], { type: 'not-found' }],
    [['tools', 'agent-strategy'], { type: 'not-found' }],
    [['tools', 'extension'], { type: 'not-found' }],
    [['discover'], { type: 'not-found' }],
    [['missing'], { type: 'not-found' }],
  ])('resolves slug %j', (slug, expected) => {
    expect(getIntegrationRouteTargetBySlug(slug)).toEqual(expected)
  })

  it('preserves query params when redirecting legacy custom tool route', () => {
    expect(
      getIntegrationRouteTargetBySlug(['tool', 'api'], {
        q: 'slack',
        tags: ['a', 'b'],
      }),
    ).toEqual({
      type: 'redirect',
      destination: '/integrations/tools/api?q=slack&tags=a&tags=b',
    })
  })

  it('preserves marketplace install query params when redirecting nested marketplace callbacks', () => {
    expect(
      getIntegrationRouteTargetBySlug(['agent-strategy', 'plugins'], {
        'package-ids': '["junjiem/mcp_see_agent"]',
      }),
    ).toEqual({
      type: 'redirect',
      destination: '/integrations/agent-strategy?package-ids=%5B%22junjiem%2Fmcp_see_agent%22%5D',
    })
  })

  it('preserves marketplace install query params when redirecting model and data source callbacks', () => {
    expect(
      getIntegrationRouteTargetBySlug(['model-provider', 'plugins'], {
        'package-ids': '["langgenius/openai"]',
      }),
    ).toEqual({
      type: 'redirect',
      destination: '/integrations/model-provider?package-ids=%5B%22langgenius%2Fopenai%22%5D',
    })
    expect(
      getIntegrationRouteTargetBySlug(['data-source', 'plugins'], {
        'package-ids': '["langgenius/notion_datasource"]',
      }),
    ).toEqual({
      type: 'redirect',
      destination:
        '/integrations/data-source?package-ids=%5B%22langgenius%2Fnotion_datasource%22%5D',
    })
  })

  it.each([
    [{}, '/integrations/tools/built-in'],
    [{ section: 'provider' }, '/integrations/model-provider'],
    [{ section: 'builtin' }, '/integrations/tools/built-in'],
    [{ category: 'builtin' }, '/integrations/tools/built-in'],
    [{ category: 'api' }, '/integrations/tools/api'],
    [{ category: 'workflow' }, '/integrations/tools/workflow'],
    [{ category: 'mcp' }, '/integrations/tools/mcp'],
    [{ section: 'data-source' }, '/integrations/data-source'],
    [{ section: 'custom-endpoint' }, '/integrations/custom-endpoint'],
    [
      { section: 'custom-tool', category: 'api', q: 'slack', tags: ['a', 'b'] },
      '/integrations/tools/api?q=slack&tags=a&tags=b',
    ],
  ])('builds legacy /tools redirect for search params %j', (searchParams, expected) => {
    expect(getIntegrationRedirectPathByLegacyToolsSearchParams(searchParams)).toBe(expected)
  })
})
