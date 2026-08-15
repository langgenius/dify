import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createServer } from 'node:http'

/**
 * Local Marketplace API stub for the performance benchmark.
 *
 * The embedded Marketplace page talks directly to NEXT_PUBLIC_MARKETPLACE_API_PREFIX
 * from both the Next.js server and the browser. Serving frozen fixtures from this
 * stub keeps the measured first-screen content identical on every run, so the
 * rendering budgets do not depend on live marketplace.dify.ai content.
 */

const stubHost = '127.0.0.1'
const apiPrefixPath = '/api/v1'

const pluginIconSvg = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">',
  '<rect width="40" height="40" rx="8" fill="#E5E7EB"/>',
  '<circle cx="20" cy="20" r="10" fill="#6B7280"/>',
  '</svg>',
].join('')

const makeFrozenPlugin = (name: string, label: string, installCount: number) => ({
  type: 'plugin',
  org: 'e2e-fixtures',
  name,
  plugin_id: `e2e-fixtures/${name}`,
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: `e2e-fixtures/${name}:1.0.0`,
  icon: 'icon.svg',
  verified: true,
  label: { en_US: label, zh_Hans: label },
  brief: {
    en_US: `${label} is a frozen fixture plugin for the performance benchmark.`,
    zh_Hans: `${label} is a frozen fixture plugin for the performance benchmark.`,
  },
  introduction: '',
  repository: '',
  category: 'tool',
  install_count: installCount,
  endpoint: { settings: [] },
  tags: [{ name: 'search' }],
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
})

const makeFrozenCollection = (name: string, label: string) => ({
  name,
  label: { en_US: label, zh_Hans: label },
  description: {
    en_US: `${label} frozen fixture collection.`,
    zh_Hans: `${label} frozen fixture collection.`,
  },
  rule: '',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  searchable: false,
})

const frozenCollections = [
  makeFrozenCollection('e2e-frozen-featured', 'Frozen Featured'),
  makeFrozenCollection('e2e-frozen-popular', 'Frozen Popular'),
]

const frozenCollectionPlugins: Record<string, unknown[]> = {
  'e2e-frozen-featured': Array.from({ length: 8 }, (_, index) =>
    makeFrozenPlugin(
      `featured-plugin-${index + 1}`,
      `Featured Plugin ${index + 1}`,
      12_000 - index * 100,
    ),
  ),
  'e2e-frozen-popular': Array.from({ length: 8 }, (_, index) =>
    makeFrozenPlugin(
      `popular-plugin-${index + 1}`,
      `Popular Plugin ${index + 1}`,
      8_000 - index * 100,
    ),
  ),
}

type StubResponse = {
  body: string
  contentType: string
}

const jsonResponse = (data: unknown): StubResponse => ({
  body: JSON.stringify({ code: 0, msg: 'success', data }),
  contentType: 'application/json',
})

const resolveStubResponse = (method: string, pathname: string): StubResponse | undefined => {
  if (method === 'GET' && pathname === '/banners') return jsonResponse({ banners: [] })
  if (method === 'GET' && pathname === '/collections')
    return jsonResponse({ collections: frozenCollections })

  const collectionPluginsMatch = pathname.match(/^\/collections\/([^/]+)\/plugins$/)
  if (method === 'POST' && collectionPluginsMatch) {
    return jsonResponse({
      plugins: frozenCollectionPlugins[collectionPluginsMatch[1]!] ?? [],
    })
  }

  if (method === 'POST' && /^\/(?:plugins|bundles)\/search\/advanced$/.test(pathname))
    return jsonResponse({ plugins: [], bundles: [], total: 0 })
  if (method === 'GET' && pathname === '/template-collections')
    return jsonResponse({ collections: [], total: 0 })
  if (method === 'POST' && /^\/template-collections\/[^/]+\/templates$/.test(pathname))
    return jsonResponse({ templates: [], total: 0 })
  if (method === 'POST' && pathname === '/templates/search/advanced')
    return jsonResponse({ templates: [], total: 0 })
  if (method === 'GET' && /^\/(?:plugins|bundles)\/[^/]+\/[^/]+\/icon$/.test(pathname))
    return { body: pluginIconSvg, contentType: 'image/svg+xml' }

  return undefined
}

const handleRequest = (request: IncomingMessage, response: ServerResponse) => {
  request.resume()

  const method = request.method ?? 'GET'
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? stubHost}`)
  const requestedHeaders = request.headers['access-control-request-headers']

  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  response.setHeader(
    'Access-Control-Allow-Headers',
    Array.isArray(requestedHeaders) ? requestedHeaders.join(',') : (requestedHeaders ?? '*'),
  )
  response.setHeader('Cache-Control', 'no-store')

  if (method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  const pathname = url.pathname.startsWith(apiPrefixPath)
    ? url.pathname.slice(apiPrefixPath.length) || '/'
    : undefined
  const stubResponse = pathname === undefined ? undefined : resolveStubResponse(method, pathname)

  if (!stubResponse) {
    console.warn(`Marketplace stub has no fixture for ${method} ${url.pathname}; returning 404.`)
    response.writeHead(404, { 'Content-Type': 'application/json' })
    response.end(
      JSON.stringify({ code: 404, msg: 'Marketplace stub fixture not found', data: null }),
    )
    return
  }

  response.writeHead(200, { 'Content-Type': stubResponse.contentType })
  response.end(stubResponse.body)
}

let activeServer: Server | undefined

export const startMarketplaceStub = async (): Promise<{ apiPrefix: string }> => {
  if (activeServer) throw new Error('The Marketplace API stub is already running.')

  const port = Number(process.env.E2E_MARKETPLACE_STUB_PORT || 3620)
  const server = createServer(handleRequest)

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(port, stubHost, () => {
      server.off('error', onError)
      resolve()
    })
  })

  activeServer = server
  return { apiPrefix: `http://${stubHost}:${port}${apiPrefixPath}` }
}

export const stopMarketplaceStub = async () => {
  const server = activeServer
  activeServer = undefined
  if (!server) return

  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
