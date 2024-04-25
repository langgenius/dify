import { get } from './base'
import type { EnterpriseFeatures } from '@/types/enterprise'

export const getEnterpriseFeatures = () => {
  return get<EnterpriseFeatures>('/enterprise-features')
}

export const getSAMLSSOUrl = () => {
  return get<{ url: string }>('/enterprise/sso/saml/login')
}

export const getOIDCSSOUrl = () => {
  return get<{ url: string; state: string }>('/enterprise/sso/oidc/login')
}
