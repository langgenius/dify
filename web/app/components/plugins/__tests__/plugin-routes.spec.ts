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
    [{ tab: 'discover' }, '/marketplace'],
    [{ tab: 'discover', category: 'extension' }, '/marketplace?category=extension'],
    [{ tab: 'discover', q: 'slack', tags: ['a', 'b'] }, '/marketplace?q=slack&tags=a&tags=b'],
    [{ tab: 'all' }, '/marketplace?category=all'],
    [{ tab: 'tool' }, '/marketplace?category=tool'],
    [{ tab: 'model' }, '/marketplace?category=model'],
    [{ tab: 'trigger' }, '/marketplace?category=trigger'],
    [{ tab: 'agent-strategy' }, '/marketplace?category=agent-strategy'],
    [{ tab: 'extension' }, '/marketplace?category=extension'],
    [{ tab: 'datasource' }, '/marketplace?category=datasource'],
    [{ tab: 'bundle' }, '/marketplace?category=bundle'],
  ])('redirects marketplace plugin URLs for search params %j', (searchParams, expected) => {
    expect(getLegacyPluginRedirectPath(searchParams)).toBe(expected)
  })

  it.each([
    { tab: 'unsupported' },
  ])('does not redirect unsupported plugin URLs for search params %j', (searchParams) => {
    expect(getLegacyPluginRedirectPath(searchParams)).toBeUndefined()
  })
})
