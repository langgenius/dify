import type { HttpClient } from '@/http/types'
import { describe, expect, it, vi } from 'vitest'
import { PermittedExternalAppsClient } from './permitted-external-apps'

function fakeHttp() {
  return { baseURL: 'https://x', request: vi.fn() } as unknown as HttpClient
}

type WithOrpc = { orpc: unknown }

describe('PermittedExternalAppsClient', () => {
  it('list calls permittedExternalApps.get with paging/filter query', async () => {
    const c = new PermittedExternalAppsClient(fakeHttp())
    const get = vi.fn().mockResolvedValue({ page: 1, limit: 20, total: 0, has_more: false, data: [] })
    ;(c as unknown as WithOrpc).orpc = { permittedExternalApps: { get, byAppId: { get: vi.fn() } } }
    await c.list({ workspaceId: '', page: 2, limit: 5, mode: undefined, name: 'a' })
    expect(get).toHaveBeenCalledWith({ query: { page: 2, limit: 5, mode: undefined, name: 'a' } })
  })

  it('describe calls permittedExternalApps.byAppId.get with app_id + fields', async () => {
    const c = new PermittedExternalAppsClient(fakeHttp())
    const dget = vi.fn().mockResolvedValue({ info: null, parameters: null, input_schema: null })
    ;(c as unknown as WithOrpc).orpc = { permittedExternalApps: { get: vi.fn(), byAppId: { get: dget } } }
    await c.describe('app-1', ['info'])
    expect(dget).toHaveBeenCalledWith({ params: { app_id: 'app-1' }, query: { fields: 'info' } })
  })
})
