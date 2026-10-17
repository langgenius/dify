const toLinkPath = (pathname: string) => `/${pathname.replace(/^\/|\/$/g, '')}` as const

/**
 * Splits an API prefix into the `origin` and path `url` options of a v2 `OpenAPILink`.
 * A path-only prefix keeps requests on the page origin.
 */
export function toOpenAPILinkBase(apiPrefix: string | URL): {
  origin?: string
  url: `/${string}`
} {
  if (typeof apiPrefix === 'string' && apiPrefix.startsWith('/'))
    return { url: toLinkPath(apiPrefix) }
  const { origin, pathname } = new URL(apiPrefix)
  return { origin, url: toLinkPath(pathname) }
}
