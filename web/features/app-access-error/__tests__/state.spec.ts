import {
  appAccessErrorAtom,
  appAccessStore,
  captureAppAccessRequest,
  captureAppAccessScope,
  getAppAccessScopeKey,
  handleAppAccessError,
  hasAppAccessError,
  isAppAccessError,
  isAppAccessScopeCurrent,
} from '../state'

const denied = { code: 'ip_access_denied', client_ip: '203.0.113.42' }
const navigate = (path: string) => {
  window.history.replaceState({}, '', path)
  return captureAppAccessScope()
}

describe('WebApp IP denial scope', () => {
  beforeEach(() => {
    navigate('/')
  })

  it.each([
    ['/workflow/app', 'webapp:default:app'],
    ['/chat/app', 'webapp:default:app'],
    ['/chatbot/app', 'webapp:default:app'],
    ['/completion/app', 'webapp:default:app'],
    ['/agent/app', 'webapp:default:app'],
    ['/environment/chat/app', 'webapp:environment:app'],
    ['/environment/workflow/app', 'webapp:environment:app'],
    ['/form/token', 'form:token'],
  ])('scopes the public entry %s', (path, expected) => {
    expect(navigate(path)?.key).toBe(expected)
  })

  it('resolves a validated sign-in target without scoping console or external redirects', () => {
    expect(getAppAccessScopeKey('/webapp-signin', '?redirect_url=%2Fchat%2Fapp')).toBe(
      'webapp:default:app',
    )
    expect(getAppAccessScopeKey('/apps', '?redirect_url=%2Fchat%2Fapp')).toBeNull()
    expect(
      getAppAccessScopeKey('/webapp-signin', '?redirect_url=https://untrusted.example/chat/app'),
    ).toBeNull()
  })

  it('keeps one denial across concurrent requests and conversation query changes', () => {
    const scope = navigate('/chat/app')
    const error = new Response('', { status: 403 })
    expect(handleAppAccessError(403, denied, scope, error)).toBe(true)
    const firstDenial = appAccessStore.get(appAccessErrorAtom)

    const sameScope = navigate('/chat/app?conversation=second')
    handleAppAccessError(403, denied, sameScope)

    expect(sameScope).toBe(scope)
    expect(appAccessStore.get(appAccessErrorAtom)).toBe(firstDenial)
    expect(hasAppAccessError(scope)).toBe(true)
    expect(isAppAccessError(error)).toBe(true)
  })

  it('ignores a late denial even after navigating back to the same app', () => {
    const previousVisit = navigate('/chat/app')
    navigate('/chat/other-app')
    const currentVisit = navigate('/chat/app')
    const error = new Response('', { status: 403 })

    expect(handleAppAccessError(403, denied, previousVisit, error)).toBe(true)
    expect(isAppAccessScopeCurrent(previousVisit)).toBe(false)
    expect(hasAppAccessError(currentVisit)).toBe(false)
    expect(isAppAccessError(error)).toBe(true)
  })

  it('does not carry a denial into another app or HITL form', () => {
    handleAppAccessError(403, denied, navigate('/chat/app'))
    const other = navigate('/form/token')

    expect(hasAppAccessError(other)).toBe(false)
    expect(appAccessStore.get(appAccessErrorAtom)).toBeNull()
  })

  it.each([
    [401, { code: 'unauthorized' }],
    [403, { code: 'web_app_access_denied' }],
    [503, { code: 'policy_unavailable' }],
  ])('leaves %s %j to its existing error owner', (status, body) => {
    const scope = navigate('/workflow/app')
    expect(handleAppAccessError(status, body, scope)).toBe(false)
    expect(hasAppAccessError(scope)).toBe(false)
  })

  it('does not suppress an unhandled console error with the same error code', () => {
    const scope = navigate('/apps')
    const error = { status: 403, response: denied }
    expect(handleAppAccessError(403, denied, scope, error)).toBe(false)
    expect(isAppAccessError(error)).toBe(false)
  })
})

describe('application identity request matching', () => {
  it.each([
    ['/app/one/workflow', '/console/api/apps/one', false, true, true],
    ['/app/one/workflow', '/apps/two', false, false, false],
    ['/app/one/workflow', '/apps/one/workflows/draft', false, true, false],
    ['/agents/one/access', '/console/api/agent/one', false, true, true],
    ['/explore/installed/one', '/installed-apps/one/parameters', false, true, true],
    ['/chat/one', '/site', true, true, true],
    ['/chat/one', '/webapp/access-mode?appCode=two', true, false, false],
    ['/environment/agent/one', '/environment/two/site', true, false, false],
    ['/chat/one', '/conversations/missing/messages', true, true, false],
    ['/form/token', '/form/human_input/token', true, true, false],
  ])('scopes %s requesting %s', (route, url, isPublic, scoped, identity) => {
    navigate(route)
    const result = captureAppAccessRequest(url, isPublic)
    expect(Boolean(result.scope)).toBe(scoped)
    expect(result.appIdentity).toBe(identity)
  })
})
