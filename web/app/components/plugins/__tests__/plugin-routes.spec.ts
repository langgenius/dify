import {
  getFirstPackageIdFromSearchParams,
  getInstallRedirectPathByPluginCategory,
  getInstallRedirectPathFromSearchParams,
  getLegacyPluginRedirectPath,
  shouldResolveInstallCategoryRedirect,
} from '../plugin-routes'

describe('plugin routes', () => {
  it.each([
    [{}, '/integrations'],
    [{ tab: 'plugins' }, '/integrations'],
    [{ tab: ['plugins', 'discover'] }, '/integrations'],
  ])('redirects installed plugin URLs for search params %j', (searchParams, expected) => {
    expect(getLegacyPluginRedirectPath(searchParams)).toBe(expected)
  })

  it.each([
    [{ tab: 'trigger' }, '/integrations/trigger'],
    [{ tab: 'agent-strategy' }, '/integrations/agent-strategy'],
    [{ tab: 'extension' }, '/integrations/extension'],
    [
      {
        tab: 'trigger',
        'package-ids': '["langgenius/telegram_trigger"]',
        source: 'https://marketplace.dify.ai',
      },
      '/integrations/trigger?package-ids=%5B%22langgenius%2Ftelegram_trigger%22%5D',
    ],
  ])('redirects legacy plugin category URLs for search params %j', (searchParams, expected) => {
    expect(getLegacyPluginRedirectPath(searchParams)).toBe(expected)
  })

  it.each([
    { 'package-ids': '["langgenius/telegram_trigger"]' },
    { tab: 'plugins', 'package-ids': '["langgenius/telegram_trigger"]' },
    { 'bundle-info': '{"org":"langgenius","name":"bundle","version":"1.0.0"}' },
  ])('keeps install deep links on the legacy plugin page for search params %j', (searchParams) => {
    expect(getLegacyPluginRedirectPath(searchParams)).toBeUndefined()
  })

  it('parses the first package id from marketplace install search params', () => {
    expect(
      getFirstPackageIdFromSearchParams({
        'package-ids':
          '["junjiem/mcp_see_agent:0.2.4@82caf96890992e9dec2c43c3fac82bfce8bd18a41de7c2b6948151b2d7f7b7a2"]',
      }),
    ).toBe(
      'junjiem/mcp_see_agent:0.2.4@82caf96890992e9dec2c43c3fac82bfce8bd18a41de7c2b6948151b2d7f7b7a2',
    )
  })

  it.each([
    [{ 'package-ids': '["junjiem/mcp_see_agent"]' }, true],
    [{ tab: 'plugins', 'package-ids': '["junjiem/mcp_see_agent"]' }, true],
    [{ tab: 'trigger', 'package-ids': '["langgenius/telegram_trigger"]' }, false],
    [{ 'bundle-info': '{"org":"langgenius","name":"bundle","version":"1.0.0"}' }, false],
  ])(
    'detects package install deep links that need category resolution for search params %j',
    (searchParams, expected) => {
      expect(shouldResolveInstallCategoryRedirect(searchParams)).toBe(expected)
    },
  )

  it.each([
    [
      'model',
      { 'package-ids': '["langgenius/openai"]' },
      '/integrations/model-provider?package-ids=%5B%22langgenius%2Fopenai%22%5D',
    ],
    [
      'agent-strategy',
      { 'package-ids': '["junjiem/mcp_see_agent"]' },
      '/integrations/agent-strategy?package-ids=%5B%22junjiem%2Fmcp_see_agent%22%5D',
    ],
    [
      'trigger',
      {
        tab: 'plugins',
        'package-ids': '["langgenius/telegram_trigger"]',
        source: 'https://marketplace.dify.ai',
      },
      '/integrations/trigger?package-ids=%5B%22langgenius%2Ftelegram_trigger%22%5D',
    ],
    [
      'datasource',
      { 'package-ids': '["langgenius/notion_datasource"]' },
      '/integrations/data-source?package-ids=%5B%22langgenius%2Fnotion_datasource%22%5D',
    ],
  ])(
    'builds install redirect paths from marketplace plugin category %s',
    (category, searchParams, expected) => {
      expect(getInstallRedirectPathByPluginCategory(category, searchParams)).toBe(expected)
    },
  )

  it.each([
    [
      {
        category: 'agent-strategy',
        'package-ids': '["junjiem/mcp_see_agent"]',
        source: 'https://marketplace.dify.ai',
      },
      '/integrations/agent-strategy?package-ids=%5B%22junjiem%2Fmcp_see_agent%22%5D',
    ],
    [
      {
        tab: 'trigger',
        'package-ids': '["langgenius/telegram_trigger"]',
        source: 'https://marketplace.dify.ai',
      },
      '/integrations/trigger?package-ids=%5B%22langgenius%2Ftelegram_trigger%22%5D',
    ],
    [
      {
        category: 'model',
        'package-ids': '["langgenius/openai"]',
        source: 'https://marketplace.dify.ai',
      },
      '/integrations/model-provider?package-ids=%5B%22langgenius%2Fopenai%22%5D',
    ],
    [
      {
        category: 'datasource',
        'package-ids': '["langgenius/notion_datasource"]',
        source: 'https://marketplace.dify.ai',
      },
      '/integrations/data-source?package-ids=%5B%22langgenius%2Fnotion_datasource%22%5D',
    ],
    [{ category: 'bundle', 'package-ids': '["langgenius/bundle"]' }, undefined],
    [{ category: 'agent-strategy' }, undefined],
  ])(
    'builds install redirect paths directly from install search params %j',
    (searchParams, expected) => {
      expect(getInstallRedirectPathFromSearchParams(searchParams)).toBe(expected)
    },
  )

  it.each([
    [{ tab: 'discover' }, '/marketplace'],
    [{ tab: 'discover', category: 'extension' }, '/marketplace?category=extension'],
    [{ tab: 'discover', q: 'slack', tags: ['a', 'b'] }, '/marketplace?q=slack&tags=a&tags=b'],
    [{ tab: 'all' }, '/marketplace?category=all'],
    [{ tab: 'tool' }, '/marketplace?category=tool'],
    [{ tab: 'model' }, '/marketplace?category=model'],
    [{ tab: 'datasource' }, '/marketplace?category=datasource'],
    [{ tab: 'bundle' }, '/marketplace?category=bundle'],
  ])('redirects marketplace plugin URLs for search params %j', (searchParams, expected) => {
    expect(getLegacyPluginRedirectPath(searchParams)).toBe(expected)
  })

  it.each([{ tab: 'unsupported' }, { tab: 'toString' }])(
    'does not redirect unsupported plugin URLs for search params %j',
    (searchParams) => {
      expect(getLegacyPluginRedirectPath(searchParams)).toBeUndefined()
    },
  )
})
