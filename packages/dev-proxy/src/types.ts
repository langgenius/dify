export type DevProxyServerConfig = {
  host?: string
  port?: number
}

export type DevProxyCorsAllowedOrigins = 'local' | readonly string[]

export type DevProxyCorsConfig = {
  allowedOrigins?: DevProxyCorsAllowedOrigins
}

export type CookieNameMatcher = string | RegExp

export type CookieRewriteLocalScope = 'target-origin'

export type CookieRewriteOptions = {
  hostPrefixCookies?: readonly CookieNameMatcher[]
  localCookieScope?: CookieRewriteLocalScope
  csrfHeader?: {
    cookieName: string
    headerName: string
  }
}

export type DevProxyRoute = {
  paths: string | readonly string[]
  target: string
  cookieRewrite?: CookieRewriteOptions | false
}

export type DevProxySessionImportConfig = {
  refreshPath: string
  cookieName: string
  redirectTo: string
}

export type DevProxyConfig = {
  server?: DevProxyServerConfig
  routes: readonly DevProxyRoute[]
  cors?: DevProxyCorsConfig
  sessionImport?: DevProxySessionImportConfig
}

export type DevProxyCliOptions = {
  config?: string
  envFile?: string
  host?: string
  port?: string
  watch?: boolean
  help?: boolean
}

export type DevProxyConfigLoadOptions = {
  envFile?: string | false
}

export type ResolvedDevProxyServerOptions = {
  host: string
  port: number
}

export type CreateDevProxyAppOptions = Pick<DevProxyConfig, 'routes' | 'cors' | 'sessionImport'> & {
  fetchImpl?: typeof globalThis.fetch
  logger?: Pick<Console, 'error'>
}
