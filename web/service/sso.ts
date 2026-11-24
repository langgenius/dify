import { get } from './base'

const withInviteToken = (path: string, inviteToken?: string) =>
  inviteToken ? `${path}?${new URLSearchParams({ invite_token: inviteToken })}` : path

export const getUserSAMLSSOUrl = (invite_token?: string) =>
  get<{ url: string }>(withInviteToken('/enterprise/sso/saml/login', invite_token))

export const getUserOIDCSSOUrl = (invite_token?: string) =>
  get<{ url: string; state: string }>(withInviteToken('/enterprise/sso/oidc/login', invite_token))

export const getUserOAuth2SSOUrl = (invite_token?: string) =>
  get<{ url: string; state: string }>(withInviteToken('/enterprise/sso/oauth2/login', invite_token))
