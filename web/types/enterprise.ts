export type EnterpriseFeatures = {
  sso_enforced_for_signin: boolean
  sso_enforced_for_signin_protocol: string
  sso_enforced_for_web: boolean
  sso_enforced_for_web_protocol: string
}

export const defaultEnterpriseFeatures: EnterpriseFeatures = {
  sso_enforced_for_signin: false,
  sso_enforced_for_signin_protocol: '',
  sso_enforced_for_web: false,
  sso_enforced_for_web_protocol: '',
}
