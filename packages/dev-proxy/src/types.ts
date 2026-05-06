export type DevProxyServerConfig = {
  host?: string
  port?: number
}

export type DevProxyCorsAllowedOrigins = 'local' | readonly string[]

export type DevProxyCorsConfig = {
  allowedOrigins?: DevProxyCorsAllowedOrigins
}

export type CookieNameMatcher = string | RegExp

export type CookieRewriteOptions = {
  hostPrefixCookies?: readonly CookieNameMatcher[]
}

export type DevProxyRoute = {
  paths: string | readonly string[]
  target: string
  cookieRewrite?: CookieRewriteOptions | false
}

export type DevProxyConfig = {
  server?: DevProxyServerConfig
  routes: readonly DevProxyRoute[]
  cors?: DevProxyCorsConfig
}

export type DevProxyCliOptions = {
  config?: string
  envFile?: string
  host?: string
  port?: string
  help?: boolean
}

export type DevProxyConfigLoadOptions = {
  envFile?: string | false
}

export type ResolvedDevProxyServerOptions = {
  host: string
  port: number
}

export type CreateDevProxyAppOptions = Pick<DevProxyConfig, 'routes' | 'cors'> & {
  fetchImpl?: typeof globalThis.fetch
  logger?: Pick<Console, 'error'>
}
