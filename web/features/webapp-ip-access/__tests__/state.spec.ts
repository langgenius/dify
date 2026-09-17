import {
  captureIpAccessScope,
  getIpAccessScopeKey,
  handleIpAccessDenied,
  hasIpAccessDenied,
  ipAccessDeniedAtom,
  ipAccessStore,
  isIpAccessDeniedError,
  isIpAccessScopeCurrent,
} from '../state'

const denied = { code: 'ip_access_denied', client_ip: '203.0.113.42' }
const navigate = (path: string) => {
  window.history.replaceState({}, '', path)
  return captureIpAccessScope()
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
    expect(getIpAccessScopeKey('/webapp-signin', '?redirect_url=%2Fchat%2Fapp')).toBe(
      'webapp:default:app',
    )
    expect(getIpAccessScopeKey('/apps', '?redirect_url=%2Fchat%2Fapp')).toBeNull()
    expect(
      getIpAccessScopeKey('/webapp-signin', '?redirect_url=https://untrusted.example/chat/app'),
    ).toBeNull()
  })

  it('keeps one denial across concurrent requests and conversation query changes', () => {
    const scope = navigate('/chat/app')
    const error = new Response('', { status: 403 })
    expect(handleIpAccessDenied(403, denied, scope, error)).toBe(true)
    const firstDenial = ipAccessStore.get(ipAccessDeniedAtom)

    const sameScope = navigate('/chat/app?conversation=second')
    handleIpAccessDenied(403, denied, sameScope)

    expect(sameScope).toBe(scope)
    expect(ipAccessStore.get(ipAccessDeniedAtom)).toBe(firstDenial)
    expect(hasIpAccessDenied(scope)).toBe(true)
    expect(isIpAccessDeniedError(error)).toBe(true)
  })

  it('ignores a late denial even after navigating back to the same app', () => {
    const previousVisit = navigate('/chat/app')
    navigate('/chat/other-app')
    const currentVisit = navigate('/chat/app')
    const error = new Response('', { status: 403 })

    expect(handleIpAccessDenied(403, denied, previousVisit, error)).toBe(true)
    expect(isIpAccessScopeCurrent(previousVisit)).toBe(false)
    expect(hasIpAccessDenied(currentVisit)).toBe(false)
    expect(isIpAccessDeniedError(error)).toBe(true)
  })

  it('does not carry a denial into another app or HITL form', () => {
    handleIpAccessDenied(403, denied, navigate('/chat/app'))
    const other = navigate('/form/token')

    expect(hasIpAccessDenied(other)).toBe(false)
    expect(ipAccessStore.get(ipAccessDeniedAtom)).toBeNull()
  })

  it.each([
    [401, { code: 'unauthorized' }],
    [403, { code: 'web_app_access_denied' }],
    [503, { code: 'policy_unavailable' }],
  ])('leaves %s %j to its existing error owner', (status, body) => {
    const scope = navigate('/workflow/app')
    expect(handleIpAccessDenied(status, body, scope)).toBe(false)
    expect(hasIpAccessDenied(scope)).toBe(false)
  })

  it('does not suppress an unhandled console error with the same error code', () => {
    const scope = navigate('/apps')
    const error = { status: 403, response: denied }
    expect(handleIpAccessDenied(403, denied, scope, error)).toBe(false)
    expect(isIpAccessDeniedError(error)).toBe(false)
  })
})
