import { describe, expect, it, vi } from 'vite-plus/test'
import { consoleClient } from '@/service/console'
import { marketplaceClient } from '@/service/marketplace'
import { createNetworkAccessGroupFixture } from '../console/network-access'
import { apiError, installFakeApi, route, sseResponse } from '../fake-api'

const groupList = {
  tenant_id: 'workspace-1',
  entitled: true,
  groups: [createNetworkAccessGroupFixture()],
}

describe('installFakeApi', () => {
  it('answers console contract calls through the real client with validated data', async () => {
    const list = vi.fn(() => groupList)
    const teardown = installFakeApi({
      console: { workspaces: { current: { networkAccessGroups: { get: list } } } },
    })

    const result = await consoleClient.workspaces.current.networkAccessGroups.get({})

    expect(result.groups.map((group) => group.name)).toEqual(['Internal Network'])
    expect(list).toHaveBeenCalledOnce()
    teardown()
  })

  it('decodes request bodies and returns thrown errors with their status', async () => {
    const create = vi.fn(() => {
      throw apiError('CONFLICT', 409, 'Name already exists')
    })
    const teardown = installFakeApi({
      console: { workspaces: { current: { networkAccessGroups: { post: create } } } },
    })

    await expect(
      consoleClient.workspaces.current.networkAccessGroups.post({
        body: { name: 'Office', allowed_cidrs: ['192.0.2.0/24'] },
      }),
    ).rejects.toMatchObject({ status: 409, message: 'Name already exists' })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ name: 'Office', allowed_cidrs: ['192.0.2.0/24'] }),
      }),
    )
    teardown()
  })

  it('accepts the repeated-key arrays the browser client sends to the Python API', async () => {
    const list = vi.fn(() => ({ data: [], has_more: false, limit: 20, page: 1, total: 0 }))
    const teardown = installFakeApi({ console: { apps: { get: list } } })

    await consoleClient.apps.get({ query: { page: 1, limit: 20, tag_ids: ['t1', 't2'] } })

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ tag_ids: ['t1', 't2'] }) }),
    )
    teardown()
  })

  it('serves marketplace contract calls (typed only: that contract has no runtime schemas)', async () => {
    const versions = vi.fn(() => ({ data: { versions: [] } }))
    const teardown = installFakeApi({ marketplace: { pluginVersions: versions } })

    await marketplaceClient.pluginVersions({
      params: { organization: 'langgenius', pluginName: 'plugin' },
      query: { page: 1, page_size: 20 },
    })

    expect(versions).toHaveBeenCalledWith(
      expect.objectContaining({ params: { organization: 'langgenius', pluginName: 'plugin' } }),
    )
    teardown()
  })

  it('serves REST routes and streams server-sent events', async () => {
    const teardown = installFakeApi({
      routes: [
        route('POST', 'console', '/apps/:appId/chat-messages', ({ params }) =>
          sseResponse([{ event: 'message', answer: params.appId }, { event: 'message_end' }]),
        ),
      ],
    })

    const response = await fetch('http://localhost:5001/console/api/apps/app-1/chat-messages', {
      method: 'POST',
      body: '{}',
    })

    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(await response.text()).toBe(
      'data: {"event":"message","answer":"app-1"}\n\ndata: {"event":"message_end"}\n\n',
    )
    teardown()
  })

  it('answers XMLHttpRequest uploads with the uploaded form data', async () => {
    const received = vi.fn()
    const teardown = installFakeApi({
      routes: [
        route('POST', 'console', '/files/upload', async ({ request }) => {
          const form = await request.formData()
          received((form.get('file') as File).name)
          return { id: 'file-1', name: 'report.pdf' }
        }),
      ],
    })
    const data = new FormData()
    data.append('file', new File(['%PDF'], 'report.pdf', { type: 'application/pdf' }))
    const onprogress = vi.fn()

    // Same XMLHttpRequest calls the legacy upload transport makes.
    const result = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', 'http://localhost:5001/console/api/files/upload')
      xhr.responseType = 'json'
      xhr.upload.onprogress = onprogress
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) resolve(xhr.response)
      }
      xhr.send(data)
    })

    expect(result).toEqual({ id: 'file-1', name: 'report.pdf' })
    expect(received).toHaveBeenCalledWith('report.pdf')
    expect(onprogress).toHaveBeenCalled()
    teardown()
  })

  it('fails the test when a handler returns data outside the contract', async () => {
    const teardown = installFakeApi({
      console: {
        workspaces: {
          current: {
            networkAccessGroups: {
              // @ts-expect-error -- deliberately violates the output schema.
              get: () => ({ tenant_id: 'workspace-1', groups: 'not-a-list' }),
            },
          },
        },
      },
    })

    await expect(consoleClient.workspaces.current.networkAccessGroups.get({})).rejects.toThrow()
    expect(teardown).toThrow(/Output validation failed/)
  })

  it('fails the test on requests no handler answers', async () => {
    const teardown = installFakeApi({})

    await expect(
      consoleClient.workspaces.current.networkAccessGroups.currentIp.get({}),
    ).rejects.toThrow()
    await expect(fetch('https://example.com/telemetry')).rejects.toThrow()
    expect(teardown).toThrow(
      /unhandled console request: GET \/workspaces\/current\/network-access-groups\/current-ip[\s\S]*unexpected network request: GET https:\/\/example\.com\/telemetry/,
    )
  })
})
