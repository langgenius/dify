export type EnterpriseFeatures = {
  sso_enforced_for_signin: boolean
  sso_enforced_for_signin_protocol: string
}

export const defaultEnterpriseFeatures: EnterpriseFeatures = {
  sso_enforced_for_signin: false,
  sso_enforced_for_signin_protocol: '',
}
