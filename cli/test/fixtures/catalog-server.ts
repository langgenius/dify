import type { RequestListener } from 'node:http'
import type { CapturedRequest } from './stub-server'
import { createHash } from 'node:crypto'
import catalog from './knowledge-fs-catalog.json'
import { jsonResponder } from './stub-server'

// Exported from controllers.openapi._catalog.build_catalog: the seven KnowledgeFS operations.
export const knowledgeFsCatalog = catalog
export function withCatalog(
  handler: RequestListener,
  document = knowledgeFsCatalog,
): RequestListener {
  const raw = JSON.stringify(document)
  const fingerprint = createHash('sha256').update(raw).digest('hex')
  return (req, res) => {
    if (req.url === '/openapi/v1/_catalog') {
      res.writeHead(200, { 'content-type': 'application/json', 'X-Dify-Catalog': fingerprint })
      res.end(raw)
    } else if (req.headers['x-dify-catalog'] !== fingerprint) {
      const ignored: CapturedRequest = {}
      jsonResponder(
        412,
        { code: 'catalog_stale', message: 'Catalog changed', status: 412 },
        ignored,
      )(req, res)
    } else {
      handler(req, res)
    }
  }
}
