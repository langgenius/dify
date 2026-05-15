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
    [{ tab: 'discover' }, '/integrations/discover'],
    [{ tab: 'discover', category: 'extension' }, '/integrations/discover?category=extension'],
    [{ tab: 'discover', q: 'slack', tags: ['a', 'b'] }, '/integrations/discover?q=slack&tags=a&tags=b'],
    [{ tab: 'all' }, '/integrations/discover?category=all'],
    [{ tab: 'tool' }, '/integrations/discover?category=tool'],
    [{ tab: 'model' }, '/integrations/discover?category=model'],
    [{ tab: 'trigger' }, '/integrations/discover?category=trigger'],
    [{ tab: 'agent-strategy' }, '/integrations/discover?category=agent-strategy'],
    [{ tab: 'extension' }, '/integrations/discover?category=extension'],
    [{ tab: 'datasource' }, '/integrations/discover?category=datasource'],
    [{ tab: 'bundle' }, '/integrations/discover?category=bundle'],
  ])('redirects marketplace plugin URLs for search params %j', (searchParams, expected) => {
    expect(getLegacyPluginRedirectPath(searchParams)).toBe(expected)
  })

  it.each([
    { tab: 'unsupported' },
  ])('does not redirect unsupported plugin URLs for search params %j', (searchParams) => {
    expect(getLegacyPluginRedirectPath(searchParams)).toBeUndefined()
  })
})
