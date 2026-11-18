import { describe, expect, it, vi } from 'vite-plus/test'
import { consoleClient } from '@/service/console'
import { marketplaceClient } from '@/service/marketplace'
import { createNetworkAccessGroupFixture } from '../console/network-access'
import { apiError, installFakeApi, networkError, route, sseResponse } from '../fake-api'

const groupList = {
  tenant_id: 'workspace-1',
  entitled: true,
  groups: [createNetworkAccessGroupFixture()],
}

describe('installFakeApi', () => {
  it('answers console contract calls and records them on the handler spy', async () => {
    const fake = installFakeApi({
      console: { workspaces: { current: { networkAccessGroups: { get: () => groupList } } } },
    })

    const result = await consoleClient.workspaces.current.networkAccessGroups.get({})

    expect(result.groups.map((group) => group.name)).toEqual(['Internal Network'])
    expect(fake.console.workspaces.current.networkAccessGroups.get).toHaveBeenCalledOnce()
    fake()
  })

  it('types spies from the contract, so a sync default can later answer with a deferred', async () => {
    const fake = installFakeApi({
      console: { workspaces: { current: { networkAccessGroups: { get: () => groupList } } } },
    })
    const spy = fake.console.workspaces.current.networkAccessGroups.get
    spy.mockReturnValueOnce(Promise.resolve({ ...groupList, groups: [] }))

    expect((await consoleClient.workspaces.current.networkAccessGroups.get({})).groups).toEqual([])
    expect(spy.mock.calls[0]![0]).toEqual(expect.objectContaining({ query: {} }))
    fake()
  })

  it('overrides and adds handlers mid-test with use()', async () => {
    const fake = installFakeApi({
      console: { workspaces: { current: { networkAccessGroups: { get: () => groupList } } } },
    })
    await consoleClient.workspaces.current.networkAccessGroups.get({})

    fake.use({
      console: {
        workspaces: {
          current: {
            networkAccessGroups: {
              get: () => ({ ...groupList, groups: [] }),
              currentIp: { get: () => ({ client_ip: '203.0.113.42' }) },
            },
          },
        },
      },
    })

    expect((await consoleClient.workspaces.current.networkAccessGroups.get({})).groups).toEqual([])
    expect(await consoleClient.workspaces.current.networkAccessGroups.currentIp.get({})).toEqual({
      client_ip: '203.0.113.42',
    })
    expect(fake.console.workspaces.current.networkAccessGroups.get).toHaveBeenCalledTimes(2)
    fake()
  })

  it('decodes request bodies and returns thrown errors with their status', async () => {
    const fake = installFakeApi({
      console: {
        workspaces: {
          current: {
            networkAccessGroups: {
              post: () => {
                throw apiError({ status: 409, code: 'CONFLICT', message: 'Name already exists' })
              },
            },
          },
        },
      },
    })

    await expect(
      consoleClient.workspaces.current.networkAccessGroups.post({
        body: { name: 'Office', allowed_cidrs: ['192.0.2.0/24'] },
      }),
    ).rejects.toMatchObject({ status: 409, message: 'Name already exists' })
    expect(fake.console.workspaces.current.networkAccessGroups.post).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ name: 'Office', allowed_cidrs: ['192.0.2.0/24'] }),
      }),
    )
    fake()
  })

  it('accepts the repeated-key arrays the browser client sends to the Python API', async () => {
    const fake = installFakeApi({
      console: {
        apps: { get: () => ({ data: [], has_more: false, limit: 20, page: 1, total: 0 }) },
      },
    })

    await consoleClient.apps.get({ query: { page: 1, limit: 20, tag_ids: ['t1', 't2'] } })

    expect(fake.console.apps.get).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ tag_ids: ['t1', 't2'] }) }),
    )
    fake()
  })

  it('serves marketplace contract calls (typed only: that contract has no runtime schemas)', async () => {
    const fake = installFakeApi({
      marketplace: { pluginVersions: () => ({ data: { versions: [] } }) },
    })

    await marketplaceClient.pluginVersions({
      params: { organization: 'langgenius', pluginName: 'plugin' },
      query: { page: 1, page_size: 20 },
    })

    expect(fake.marketplace.pluginVersions).toHaveBeenCalledWith(
      expect.objectContaining({ params: { organization: 'langgenius', pluginName: 'plugin' } }),
    )
    fake()
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
    const fake = installFakeApi({
      routes: [
        route('POST', 'console', '/files/upload', () => ({ id: 'file-1', name: 'report.pdf' })),
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
    const [{ request }] = fake.route('POST', 'console', '/files/upload').mock.calls[0]!
    expect(((await request.formData()).get('file') as File).name).toBe('report.pdf')
    expect(onprogress).toHaveBeenCalled()
    fake()
  })

  it('sends handler errors in the backend shape, including their details', async () => {
    const teardown = installFakeApi({
      console: {
        workspaces: {
          current: {
            networkAccessGroups: {
              post: () => {
                throw apiError({
                  status: 422,
                  code: 'invalid_param',
                  message: 'Invalid CIDR',
                  details: { details: { issues: ['allowed_cidrs'] } },
                })
              },
            },
          },
        },
      },
    })

    await expect(
      consoleClient.workspaces.current.networkAccessGroups.post({
        body: { name: 'Office', allowed_cidrs: ['nope'] },
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: 'Invalid CIDR',
      data: expect.objectContaining({ details: { issues: ['allowed_cidrs'] } }),
    })
    teardown()
  })

  it('serves contracts from the enterprise segment', async () => {
    const fake = installFakeApi({
      console: {
        enterprise: {
          webAppAuth: {
            searchForWhilteListCandidates: () => ({
              subjects: [],
              currPage: 1,
              totalPages: 1,
              hasMore: false,
            }),
          },
        },
      },
    })

    await consoleClient.enterprise.webAppAuth
      .searchForWhilteListCandidates({
        query: { pageNumber: 1, resultsPerPage: 10 },
      })
      .catch(() => undefined)

    expect(fake.console.enterprise.webAppAuth.searchForWhilteListCandidates).toHaveBeenCalledOnce()
    fake()
  })

  it('routes relative requests on the page origin', async () => {
    const lookup = vi.fn(() => ({ status: 'pending' }))
    const teardown = installFakeApi({
      routes: [route('GET', 'origin', '/openapi/v1/oauth/device/lookup', lookup)],
    })

    const response = await fetch('/openapi/v1/oauth/device/lookup?user_code=ABCD')

    expect(await response.json()).toEqual({ status: 'pending' })
    teardown()
  })

  it('fails requests at the network level when a handler throws networkError()', async () => {
    const teardown = installFakeApi({
      console: {
        workspaces: {
          current: {
            networkAccessGroups: {
              get: () => {
                throw networkError()
              },
            },
          },
        },
      },
      routes: [
        route('GET', 'console', '/legacy', () => {
          throw networkError()
        }),
      ],
    })

    await expect(consoleClient.workspaces.current.networkAccessGroups.get({})).rejects.toThrow(
      /network error/,
    )
    await expect(fetch('http://localhost:5001/console/api/legacy')).rejects.toThrow(
      'Failed to fetch',
    )
    teardown()
  })

  it('gives routes the parsed body and returns typed spies for handlers added with use()', async () => {
    const fake = installFakeApi({
      routes: [route('POST', 'console', '/forgot-password/validity', () => ({ is_valid: true }))],
    })
    await fetch('http://localhost:5001/console/api/forgot-password/validity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'abc' }),
    })
    const added = fake.use({
      console: { workspaces: { current: { networkAccessGroups: { get: () => groupList } } } },
    })
    await consoleClient.workspaces.current.networkAccessGroups.get({})

    expect(fake.route('POST', 'console', '/forgot-password/validity')).toHaveBeenCalledWith(
      expect.objectContaining({ body: { token: 'abc' } }),
    )
    expect(added.console.workspaces.current.networkAccessGroups.get).toHaveBeenCalledOnce()
    fake()
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
