import { getUserOAuth2SSOUrl, getUserOIDCSSOUrl, getUserSAMLSSOUrl } from '../sso'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const sentURL = (fetchSpy: ReturnType<typeof vi.spyOn>, index = 0) =>
  new URL((fetchSpy.mock.calls[index]![0] as Request).url)

describe('SSO login URLs', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        Response.json({ url: 'https://idp.example.com', state: 'state-1' }),
      )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['SAML', getUserSAMLSSOUrl, '/console/api/enterprise/sso/saml/login'],
    ['OIDC', getUserOIDCSSOUrl, '/console/api/enterprise/sso/oidc/login'],
    ['OAuth2', getUserOAuth2SSOUrl, '/console/api/enterprise/sso/oauth2/login'],
  ])('omits the invite token for %s when none is given', async (_, getUrl, path) => {
    await expect(getUrl()).resolves.toMatchObject({ url: 'https://idp.example.com' })
    await getUrl('')

    for (const index of [0, 1]) {
      const url = sentURL(fetchSpy, index)
      expect(url.pathname).toBe(path)
      expect(url.search).toBe('')
    }
  })

  it.each([
    ['SAML', getUserSAMLSSOUrl, '/console/api/enterprise/sso/saml/login'],
    ['OIDC', getUserOIDCSSOUrl, '/console/api/enterprise/sso/oidc/login'],
    ['OAuth2', getUserOAuth2SSOUrl, '/console/api/enterprise/sso/oauth2/login'],
  ])('sends the invite token for %s', async (_, getUrl, path) => {
    await getUrl('a+b/c=d&next=/apps')

    const url = sentURL(fetchSpy)
    expect(url.pathname).toBe(path)
    expect(url.searchParams.get('invite_token')).toBe('a+b/c=d&next=/apps')
  })

  it('returns the OIDC state the callback checks', async () => {
    await expect(getUserOIDCSSOUrl()).resolves.toEqual({
      url: 'https://idp.example.com',
      state: 'state-1',
    })
  })
})
