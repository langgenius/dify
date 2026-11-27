import { oc, type } from '@orpc/contract'

// These SSO contracts are manually maintained. The enterprise OpenAPI spec documents the console
// login routes without their invite token, and the web app login routes are not documented at all.

const base = oc.$route({ inputStructure: 'detailed' })

export type SsoLoginUrlResponse = {
  url: string
}

/** OIDC and OAuth2 logins also return the state the callback checks. */
export type SsoLoginUrlWithStateResponse = SsoLoginUrlResponse & {
  state: string
}

type ConsoleSsoLoginInput = {
  query?: {
    /** Joins the workspace the invitation is for after signing in. */
    invite_token?: string
  }
}

const consoleSamlLogin = base
  .route({ path: '/enterprise/sso/saml/login', method: 'GET' })
  .input(type<ConsoleSsoLoginInput | undefined>())
  .output(type<SsoLoginUrlResponse>())

const consoleOidcLogin = base
  .route({ path: '/enterprise/sso/oidc/login', method: 'GET' })
  .input(type<ConsoleSsoLoginInput | undefined>())
  .output(type<SsoLoginUrlWithStateResponse>())

const consoleOAuth2Login = base
  .route({ path: '/enterprise/sso/oauth2/login', method: 'GET' })
  .input(type<ConsoleSsoLoginInput | undefined>())
  .output(type<SsoLoginUrlWithStateResponse>())

/** Console (workspace member) SSO login URLs, served under the console API. */
export const consoleSsoContract = {
  samlLogin: consoleSamlLogin,
  oidcLogin: consoleOidcLogin,
  oAuth2Login: consoleOAuth2Login,
}

type WebAppSsoLoginInput = {
  query: {
    app_code: string
    /** Where the identity provider returns to after signing in. */
    redirect_url: string
  }
}

const webAppSsoLogin = (path: `/enterprise/sso/${string}`) =>
  base
    .route({ path, method: 'GET' })
    .input(type<WebAppSsoLoginInput>())
    .output(type<SsoLoginUrlResponse>())

/** Web app SSO login URLs, served under the public web app API. */
export const webAppSsoContract = {
  /** External users of a web app. */
  samlLogin: webAppSsoLogin('/enterprise/sso/saml/login'),
  oidcLogin: webAppSsoLogin('/enterprise/sso/oidc/login'),
  oAuth2Login: webAppSsoLogin('/enterprise/sso/oauth2/login'),
  /** Workspace members opening a web app. */
  members: {
    samlLogin: webAppSsoLogin('/enterprise/sso/members/saml/login'),
    oidcLogin: webAppSsoLogin('/enterprise/sso/members/oidc/login'),
    oAuth2Login: webAppSsoLogin('/enterprise/sso/members/oauth2/login'),
  },
}
