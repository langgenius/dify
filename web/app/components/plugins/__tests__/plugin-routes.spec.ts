import { getLegacyPluginRedirectPath } from '../plugin-routes'

describe('plugin routes', () => {
  it.each([
    [{}, '/integrations'],
    [{ tab: 'plugins' }, '/integrations'],
    [{ tab: ['plugins', 'discover'] }, '/integrations'],
  ])('redirects installed plugin URLs for search params %j', (searchParams, expected) => {
    expect(getLegacyPluginRedirectPath(searchParams)).toBe(expected)
  })

  it.each([
    { tab: 'discover' },
    { tab: 'all' },
    { tab: 'tool' },
    { tab: 'model' },
    { tab: 'trigger' },
    { tab: 'agent-strategy' },
    { tab: 'extension' },
    { tab: 'datasource' },
    { tab: 'bundle' },
    { tab: 'unsupported' },
  ])('does not redirect marketplace or unsupported plugin URLs for search params %j', (searchParams) => {
    expect(getLegacyPluginRedirectPath(searchParams)).toBeUndefined()
  })
})
