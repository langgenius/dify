import { getUserOAuth2SSOUrl, getUserOIDCSSOUrl, getUserSAMLSSOUrl } from '../sso'

const getMock = vi.hoisted(() => vi.fn())

vi.mock('../base', () => ({
  get: getMock,
}))

describe('SSO login URLs', () => {
  beforeEach(() => {
    getMock.mockReset()
    getMock.mockResolvedValue({ url: 'https://idp.example.com' })
  })

  it.each([
    ['SAML', getUserSAMLSSOUrl, '/enterprise/sso/saml/login'],
    ['OIDC', getUserOIDCSSOUrl, '/enterprise/sso/oidc/login'],
    ['OAuth2', getUserOAuth2SSOUrl, '/enterprise/sso/oauth2/login'],
  ])('omits the invite token for %s when none is given', async (_, getUrl, path) => {
    await getUrl()
    await getUrl('')

    expect(getMock).toHaveBeenNthCalledWith(1, path)
    expect(getMock).toHaveBeenNthCalledWith(2, path)
  })

  it.each([
    ['SAML', getUserSAMLSSOUrl, '/enterprise/sso/saml/login'],
    ['OIDC', getUserOIDCSSOUrl, '/enterprise/sso/oidc/login'],
    ['OAuth2', getUserOAuth2SSOUrl, '/enterprise/sso/oauth2/login'],
  ])('encodes the invite token for %s', async (_, getUrl, path) => {
    await getUrl('a+b/c=d&next=/apps')

    expect(getMock).toHaveBeenCalledWith(`${path}?invite_token=a%2Bb%2Fc%3Dd%26next%3D%2Fapps`)
  })
})
