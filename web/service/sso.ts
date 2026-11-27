import { consoleClient } from './console'

const inviteTokenInput = (inviteToken?: string) =>
  inviteToken ? { query: { invite_token: inviteToken } } : undefined

export const getUserSAMLSSOUrl = (invite_token?: string) =>
  consoleClient.enterprise.consoleSso.samlLogin(inviteTokenInput(invite_token))

export const getUserOIDCSSOUrl = (invite_token?: string) =>
  consoleClient.enterprise.consoleSso.oidcLogin(inviteTokenInput(invite_token))

export const getUserOAuth2SSOUrl = (invite_token?: string) =>
  consoleClient.enterprise.consoleSso.oAuth2Login(inviteTokenInput(invite_token))
