import { get } from './base'

export const getUserSAMLSSOUrl = () => {
  return get<{ url: string }>('/enterprise/sso/saml/login')
}

export const getUserOIDCSSOUrl = () => {
  return get<{ url: string; state: string }>('/enterprise/sso/oidc/login')
}
