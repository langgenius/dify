import { api as consoleClient, query as consoleQuery } from './console.openapi-source'
import { api as knowledgeClient } from './knowledge-fs.openapi'

// Hover over `result`, `total`, or a query option to see inferred types.
// Type `consoleClient.datasets.` to explore the actual console endpoints.
// Hover `get` for its backend link; the optional navigation extension also enables F12.
export async function listDatasets() {
  const result = await consoleClient.datasets.get({ query: { page: 1, limit: 20 } })
  const total: number = result.total
  return { total, datasets: result.data }
}

export const datasetsQuery = consoleQuery.datasets.get.queryOptions({
  input: { query: { page: 1 } },
})

export async function uploadFile(file: File) {
  return consoleClient.files.upload.post({ body: { file, source: 'datasets' } })
}

export async function health() {
  const result = await knowledgeClient.health.get()
  const runtime: 'cloudflare-workers' | 'node-docker' = result.runtime
  return { runtime, ok: result.ok }
}
