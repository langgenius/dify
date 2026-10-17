import type { RouterContractClient } from '@orpc/contract'
import { createORPCClient } from '@orpc/client'
import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import { describe, expect, it, vi } from 'vite-plus/test'
import * as z from 'zod'
import { ConsoleOpenAPILink } from './openapi-link'

const contract = {
  precheck: oc
    .meta(
      openapi({
        inputStructure: 'detailed',
        method: 'GET',
        path: '/apps/{app_id}/workflows/{workflow_id}:precheck',
      }),
    )
    .input(
      z.object({
        params: z.object({ app_id: z.string(), workflow_id: z.string() }),
        query: z.object({ mode: z.string() }).optional(),
      }),
    ),
}

const requestedURL = async (
  input: Parameters<RouterContractClient<typeof contract>['precheck']>[0],
) => {
  const fetch = vi.fn(async (_url: string) => Response.json({}))
  const client: RouterContractClient<typeof contract> = createORPCClient(
    new ConsoleOpenAPILink(contract, {
      origin: 'https://api.example.com',
      url: '/console/api',
      fetch,
    }),
  )
  await client.precheck(input)
  return new URL(fetch.mock.calls[0]![0])
}

describe('ConsoleOpenAPILink', () => {
  it('fills path params that share a segment with a custom method', async () => {
    const url = await requestedURL({
      params: { app_id: 'app 1', workflow_id: 'wf/1' },
      query: { mode: 'full' },
    })

    expect(url.pathname).toBe('/console/api/apps/app%201/workflows/wf%2F1:precheck')
    expect(url.searchParams.get('mode')).toBe('full')
  })
})
