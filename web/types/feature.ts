export type SystemFeatures = {
  sso_enforced_for_signin: boolean
  sso_enforced_for_signin_protocol: string
  sso_enforced_for_web: boolean
  sso_enforced_for_web_protocol: string
  enable_web_sso_switch_component: boolean
}

export const defaultSystemFeatures: SystemFeatures = {
  sso_enforced_for_signin: false,
  sso_enforced_for_signin_protocol: '',
  sso_enforced_for_web: false,
  sso_enforced_for_web_protocol: '',
  enable_web_sso_switch_component: false,
}
