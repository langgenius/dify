import { describe, expect, it, vi } from 'vite-plus/test'
import { consoleClient } from '@/service/console'
import { marketplaceClient } from '@/service/marketplace'
import { createNetworkAccessGroupFixture } from '../console/network-access'
import {
  apiError,
  hold,
  installFakeApi,
  networkError,
  pendingResponse,
  route,
  setupFakeApi,
  sseResponse,
} from '../fake-api'

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
    await fake()
  })

  it('types spies from the contract, so a sync default can later answer with a deferred', async () => {
    const fake = installFakeApi({
      console: { workspaces: { current: { networkAccessGroups: { get: () => groupList } } } },
    })
    const spy = fake.console.workspaces.current.networkAccessGroups.get
    spy.mockReturnValueOnce(Promise.resolve({ ...groupList, groups: [] }))

    expect((await consoleClient.workspaces.current.networkAccessGroups.get({})).groups).toEqual([])
    expect(spy).toHaveBeenCalledWith({})
    await fake()
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
    await fake()
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
    await fake()
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
    await fake()
  })

  it('fails the test when a repeated-key array arrives as indexed keys the Python API ignores', async () => {
    const teardown = installFakeApi({
      console: {
        apps: { get: () => ({ data: [], has_more: false, limit: 20, page: 1, total: 0 }) },
      },
    })

    await fetch('http://localhost:5001/console/api/apps?page=1&tag_ids[0]=t1&tag_ids[1]=t2')

    await expect(teardown()).rejects.toThrow(/query `tag_ids\[0\]` is ignored by the Python API/)
  })

  it('keeps JSON body types as sent, so a string boolean fails the contract like the Python API', async () => {
    const teardown = installFakeApi({
      console: {
        apps: {
          byAppId: {
            workflows: {
              draft: { post: () => ({ hash: 'h', result: 'success', updated_at: 1 }) },
            },
          },
        },
      },
    })

    const response = await fetch(
      'http://localhost:5001/console/api/apps/019a0000-0000-7000-8000-000000000001/workflows/draft',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ graph: {}, features: {}, force: 'true' }),
      },
    )

    expect(response.status).toBe(400)
    await expect(teardown()).rejects.toThrow(/Input validation failed[\s\S]*force/)
  })

  it('fails the test when a request body cannot be decoded, while handler 400s stay allowed', async () => {
    const teardown = installFakeApi({
      console: {
        workspaces: {
          current: {
            networkAccessGroups: {
              post: () => {
                throw apiError({ status: 400, message: 'Invalid CIDR' })
              },
            },
          },
        },
      },
    })
    const url = 'http://localhost:5001/console/api/workspaces/current/network-access-groups'
    const send = (body: string) =>
      fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })

    expect(
      (await send(JSON.stringify({ name: 'Office', allowed_cidrs: ['10.0.0.0/8'] }))).status,
    ).toBe(400)
    await expect(teardown()).resolves.toBeUndefined()

    const broken = installFakeApi({
      console: {
        workspaces: {
          current: {
            networkAccessGroups: {
              post: () => ({ group: createNetworkAccessGroupFixture() }),
            },
          },
        },
      },
    })
    expect((await send('{"name": "Office"')).status).toBe(400)
    await expect(broken()).rejects.toThrow(
      /POST \/console\/api\/workspaces\/current\/network-access-groups: request could not be decoded/,
    )
  })

  it('fails the test when a custom-method path is sent in the split form the fake uses internally', async () => {
    const teardown = installFakeApi({
      console: {
        enterprise: {
          appDeploy: {
            deploymentService: { precheckWorkflowDeployment: () => ({ unsupported_nodes: [] }) },
          },
        },
      },
    })

    await fetch(
      'http://localhost:5001/console/api/enterprise/app-deploy/apps/app-1/workflows/workflow-1/~precheck',
    )

    await expect(teardown()).rejects.toThrow(/~precheck/)
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
    await fake()
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
    await teardown()
  })

  it('rejects a fetch aborted before or while its response is pending, like native fetch', async () => {
    const fake = installFakeApi({
      console: { workspaces: { current: { networkAccessGroups: { get: () => groupList } } } },
    })
    const url = 'http://localhost:5001/console/api/workspaces/current/network-access-groups'
    const before = new AbortController()
    before.abort()
    await expect(fetch(url, { signal: before.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })

    const request = hold(fake.console.workspaces.current.networkAccessGroups.get)
    const during = new AbortController()
    const response = fetch(url, { signal: during.signal })
    await request.arrived
    during.abort()
    request.release()
    await expect(response).rejects.toMatchObject({ name: 'AbortError' })
    await fake()
  })

  it('completes an XMLHttpRequest whose error body is not JSON, with a null JSON response', async () => {
    const fake = installFakeApi({
      routes: [
        route(
          'POST',
          'console',
          '/files/upload',
          () => new Response('Payload Too Large', { status: 413 }),
        ),
      ],
    })

    const result = await new Promise<{ status: number; response: unknown }>((resolve) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', 'http://localhost:5001/console/api/files/upload')
      xhr.responseType = 'json'
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) resolve({ status: xhr.status, response: xhr.response })
      }
      xhr.send(new FormData())
    })

    expect(result).toEqual({ status: 413, response: null })
    await fake()
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
    await fake()
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
    await teardown()
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
    await fake()
  })

  it('routes relative requests on the page origin', async () => {
    const lookup = vi.fn(() => ({ status: 'pending' }))
    const teardown = installFakeApi({
      routes: [route('GET', 'origin', '/openapi/v1/oauth/device/lookup', lookup)],
    })

    const response = await fetch('/openapi/v1/oauth/device/lookup?user_code=ABCD')

    expect(await response.json()).toEqual({ status: 'pending' })
    await teardown()
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
    await teardown()
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
    await fake()
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
    await expect(teardown()).rejects.toThrow(/Output validation failed/)
  })

  it('fails the test on requests no handler answers', async () => {
    const teardown = installFakeApi({})

    await expect(
      consoleClient.workspaces.current.networkAccessGroups.currentIp.get({}),
    ).rejects.toThrow()
    await expect(fetch('https://example.com/telemetry')).rejects.toThrow()
    await expect(teardown()).rejects.toThrow(
      /unhandled console request: GET \/workspaces\/current\/network-access-groups\/current-ip[\s\S]*unexpected network request: GET https:\/\/example\.com\/telemetry/,
    )
  })

  it('matches custom-method paths that put a parameter and a literal in one segment', async () => {
    const fake = installFakeApi({
      console: {
        enterprise: {
          appDeploy: {
            deploymentService: { precheckWorkflowDeployment: () => ({ unsupported_nodes: [] }) },
          },
        },
      },
    })
    const params = { app_id: 'app-1', workflow_id: 'workflow-1' }

    await consoleClient.enterprise.appDeploy.deploymentService.precheckWorkflowDeployment({
      params,
    })

    expect(
      fake.console.enterprise.appDeploy.deploymentService.precheckWorkflowDeployment,
    ).toHaveBeenCalledWith({ params })
    await fake()
  })

  it('records exactly the request parts the client sent', async () => {
    const fake = installFakeApi({
      console: {
        workspaces: {
          current: {
            networkAccessGroups: {
              post: () => ({ group: createNetworkAccessGroupFixture() }),
            },
          },
        },
      },
    })
    const body = { name: 'Office', description: '', allowed_cidrs: ['10.0.0.0/8'] }

    await consoleClient.workspaces.current.networkAccessGroups.post({ body })

    expect(fake.console.workspaces.current.networkAccessGroups.post).toHaveBeenCalledWith({ body })
    await fake()
  })
})

describe('hold', () => {
  const api = () =>
    installFakeApi({
      console: { workspaces: { current: { networkAccessGroups: { get: () => groupList } } } },
    })

  it('keeps the next request open until the test resolves it, then serves the default', async () => {
    const fake = api()
    const spy = fake.console.workspaces.current.networkAccessGroups.get
    const request = hold(spy)
    let settled = false
    const response = consoleClient.workspaces.current.networkAccessGroups
      .get({})
      .finally(() => (settled = true))

    expect(await request.arrived).toStrictEqual({})
    expect(settled).toBe(false)
    request.resolve({ ...groupList, groups: [] })
    expect((await response).groups).toEqual([])
    expect(
      (await consoleClient.workspaces.current.networkAccessGroups.get({})).groups,
    ).toHaveLength(1)
    await fake()
  })

  it('applies an outcome settled before the request arrives, without an unhandled rejection', async () => {
    const fake = api()
    const request = hold(fake.console.workspaces.current.networkAccessGroups.get)
    request.reject(apiError({ status: 503, message: 'Unavailable' }))

    await expect(consoleClient.workspaces.current.networkAccessGroups.get({})).rejects.toThrow(
      'Unavailable',
    )
    expect(() => request.resolve(groupList)).toThrow(/settled once/)
    await fake()
  })
})

describe('teardown', () => {
  const groupsApi = () =>
    installFakeApi({
      console: { workspaces: { current: { networkAccessGroups: { get: () => groupList } } } },
    })

  it('waits for a response settled at the end of the test and reports its contract violation', async () => {
    const fake = groupsApi()
    const request = hold(fake.console.workspaces.current.networkAccessGroups.get)
    void consoleClient.workspaces.current.networkAccessGroups.get({}).catch(() => undefined)
    await request.arrived
    request.resolve({ ...groupList, groups: 'not-a-list' } as never)

    await expect(fake()).rejects.toThrow(/Output validation failed/)
  })

  it('accepts a request the test deliberately leaves held', async () => {
    const fake = groupsApi()
    const request = hold(fake.console.workspaces.current.networkAccessGroups.get)
    void consoleClient.workspaces.current.networkAccessGroups.get({}).catch(() => undefined)
    await request.arrived

    await expect(fake()).resolves.toBeUndefined()
  })

  it('accepts loading states served by pendingResponse() and requests the client aborted', async () => {
    const fake = installFakeApi({
      console: {
        workspaces: { current: { networkAccessGroups: { get: () => pendingResponse() } } },
        apps: { get: () => new Promise<never>(() => {}) },
      },
    })
    void consoleClient.workspaces.current.networkAccessGroups.get({}).catch(() => undefined)
    const controller = new AbortController()
    const aborted = fetch('http://localhost:5001/console/api/apps', { signal: controller.signal })
    await expect.poll(() => fake.console.apps.get).toHaveBeenCalled()
    controller.abort()
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })

    await expect(fake()).resolves.toBeUndefined()
  })

  it('reports a response that is still pending without being held', async () => {
    const fake = installFakeApi({
      console: {
        workspaces: {
          current: { networkAccessGroups: { get: () => new Promise<never>(() => {}) } },
        },
      },
    })
    void consoleClient.workspaces.current.networkAccessGroups.get({}).catch(() => undefined)
    await expect
      .poll(() => fake.console.workspaces.current.networkAccessGroups.get)
      .toHaveBeenCalled()

    await expect(fake()).rejects.toThrow(
      /GET \/console\/api\/workspaces\/current\/network-access-groups: still pending/,
    )
  })
})

describe('teardown with released and late requests', () => {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  it('answers a request released before it arrives with the regular handler, not the next hold', async () => {
    const fake = installFakeApi({
      console: { workspaces: { current: { networkAccessGroups: { get: () => groupList } } } },
    })
    const spy = fake.console.workspaces.current.networkAccessGroups.get
    const first = hold(spy)
    hold(spy)
    first.release()

    const result = await consoleClient.workspaces.current.networkAccessGroups.get({})

    expect(result.groups).toHaveLength(1)
    await fake()
  })

  it('waits for a released request whose regular handler is still running', async () => {
    const fake = installFakeApi({
      console: {
        workspaces: {
          current: {
            networkAccessGroups: {
              get: async () => {
                await wait(50)
                return { ...groupList, groups: 'not-a-list' } as never
              },
            },
          },
        },
      },
    })
    const request = hold(fake.console.workspaces.current.networkAccessGroups.get)
    void consoleClient.workspaces.current.networkAccessGroups.get({}).catch(() => undefined)
    await request.arrived
    request.release()

    await expect(fake()).rejects.toThrow(/Output validation failed/)
  })

  it('keeps serving requests made while teardown waits, even after globals were restored', async () => {
    const fake = installFakeApi({
      console: {
        workspaces: {
          current: {
            networkAccessGroups: {
              get: async () => {
                await wait(50)
                void fetch('http://localhost:5001/console/api/not-configured').catch(
                  () => undefined,
                )
                return groupList
              },
            },
          },
        },
      },
    })
    void consoleClient.workspaces.current.networkAccessGroups.get({}).catch(() => undefined)
    await expect
      .poll(() => fake.console.workspaces.current.networkAccessGroups.get)
      .toHaveBeenCalled()
    // Like an `afterEach` that restores globals before `onTestFinished` teardown runs.
    vi.unstubAllGlobals()

    await expect(fake()).rejects.toThrow(/unhandled console request: GET \/not-configured/)
  })

  it('fails the test when a contract or route handler throws something other than apiError()', async () => {
    const fake = installFakeApi({
      console: {
        workspaces: {
          current: {
            networkAccessGroups: {
              get: () => {
                throw new TypeError('fixture is undefined')
              },
            },
          },
        },
      },
      routes: [
        route('POST', 'console', '/files/upload', () => {
          throw new Error('route fixture broke')
        }),
      ],
    })

    await expect(consoleClient.workspaces.current.networkAccessGroups.get({})).rejects.toThrow()
    const upload = await fetch('http://localhost:5001/console/api/files/upload', { method: 'POST' })
    expect(upload.status).toBe(500)
    await expect(fake()).rejects.toThrow(
      /workspaces\.current\.networkAccessGroups\.get: handler threw unexpectedly \(TypeError: fixture is undefined\)[\s\S]*POST \/console\/api\/files\/upload: handler threw unexpectedly \(Error: route fixture broke\)/,
    )
  })
})

describe('response bodies and cancellation', () => {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  it('errors a streaming body when the request is aborted after the headers arrive', async () => {
    const fake = installFakeApi({
      routes: [
        route('GET', 'console', '/events', () =>
          sseResponse(
            (async function* () {
              yield { event: 'start' }
              await new Promise(() => {})
            })(),
          ),
        ),
      ],
    })
    const controller = new AbortController()
    const response = await fetch('http://localhost:5001/console/api/events', {
      signal: controller.signal,
    })
    const reader = response.body!.getReader()
    await reader.read()
    const next = reader.read()
    controller.abort()

    await expect(next).rejects.toMatchObject({ name: 'AbortError' })
    await fake()
  })

  it('keeps serving requests made after a slow body finishes while teardown waits', async () => {
    const fake = installFakeApi({
      routes: [
        route('GET', 'console', '/slow', () => {
          const encoder = new TextEncoder()
          return new Response(
            new ReadableStream({
              async start(controller) {
                controller.enqueue(encoder.encode('{"ok":'))
                await wait(50)
                controller.enqueue(encoder.encode('true}'))
                controller.close()
              },
            }),
            { headers: { 'content-type': 'application/json' } },
          )
        }),
      ],
    })
    const response = await fetch('http://localhost:5001/console/api/slow')
    void response
      .json()
      .then(() => fetch('http://localhost:5001/console/api/after-body'))
      .catch(() => undefined)

    await expect(fake()).rejects.toThrow(/unhandled console request: GET \/after-body/)
  })

  it('treats an aborted XMLHttpRequest as cancelled, not still pending', async () => {
    const fake = installFakeApi({
      routes: [route('POST', 'console', '/files/upload', () => new Promise<never>(() => {}))],
    })
    const xhr = new XMLHttpRequest()
    const aborted = new Promise((resolve) => (xhr.onabort = resolve))
    xhr.open('POST', 'http://localhost:5001/console/api/files/upload')
    xhr.send(new FormData())
    await expect.poll(() => fake.route('POST', 'console', '/files/upload')).toHaveBeenCalled()
    xhr.abort()
    await aborted

    await expect(fake()).resolves.toBeUndefined()
  })

  it('resolves same-origin relative API prefixes like the app clients do', async () => {
    vi.resetModules()
    vi.doMock('@/config', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/config')>()),
      API_PREFIX: '/console/api',
      PUBLIC_API_PREFIX: '/api',
    }))
    try {
      const sameOrigin = await import('../fake-api')
      const fake = sameOrigin.installFakeApi({
        routes: [sameOrigin.route('GET', 'console', '/ping', () => ({ ok: true }))],
      })
      const response = await fetch(new URL('/console/api/ping', window.location.origin))

      expect(await response.json()).toEqual({ ok: true })
      await fake()
    } finally {
      vi.doUnmock('@/config')
      vi.resetModules()
    }
  })
})

describe('request shapes the Python API rejects', () => {
  const groupBody = { name: 'Office', allowed_cidrs: ['10.0.0.0/8'] }
  const groupsUrl = 'http://localhost:5001/console/api/workspaces/current/network-access-groups'
  const groupsApi = () =>
    installFakeApi({
      console: {
        workspaces: {
          current: {
            networkAccessGroups: {
              get: () => groupList,
              post: () => ({ group: createNetworkAccessGroupFixture() }),
            },
          },
        },
      },
    })

  it('fails the test when a JSON endpoint receives a form body', async () => {
    const fake = groupsApi()
    const response = await fetch(groupsUrl, {
      method: 'POST',
      body: new URLSearchParams({ name: 'Office', allowed_cidrs: '10.0.0.0/8' }),
    })

    expect(response.status).toBe(415)
    await expect(fake()).rejects.toThrow(
      /workspaces\.current\.networkAccessGroups\.post: sent a application\/x-www-form-urlencoded body, but the API reads this body as JSON/,
    )
  })

  it('fails the test when a form body is sent to a JSON endpoint whose field accepts anything', async () => {
    const appId = '019a0000-0000-7000-8000-000000000001'
    const variableId = '019a0000-0000-7000-8000-0000000000b1'
    const fake = installFakeApi({
      console: {
        apps: {
          byAppId: {
            workflows: {
              draft: {
                variables: { byVariableId: { patch: () => ({}) as never } },
              },
            },
          },
        },
      },
    })
    const body = new FormData()
    body.set('name', 'greeting')
    body.set('value', 'hello')
    const response = await fetch(
      `http://localhost:5001/console/api/apps/${appId}/workflows/draft/variables/${variableId}`,
      { method: 'PATCH', body },
    )

    // `value` is `unknown`, so it accepts a file, but the API reads this body only as JSON.
    expect(response.status).toBe(415)
    expect(
      fake.console.apps.byAppId.workflows.draft.variables.byVariableId.patch,
    ).not.toHaveBeenCalled()
    await expect(fake()).rejects.toThrow(
      /apps\.byAppId\.workflows\.draft\.variables\.byVariableId\.patch: sent a multipart\/form-data body, but the API reads this body as JSON/,
    )
  })

  it('accepts a form body on an upload endpoint, whose body has a file field', async () => {
    const uploaded = {
      id: '019a0000-0000-7000-8000-0000000000c1',
      name: 'report.pdf',
      size: 4,
    }
    const fake = installFakeApi({ console: { files: { upload: { post: () => uploaded } } } })
    const body = new FormData()
    body.set('file', new File(['%PDF'], 'report.pdf', { type: 'application/pdf' }))
    const response = await fetch('http://localhost:5001/console/api/files/upload', {
      method: 'POST',
      body,
    })

    expect(response.ok).toBe(true)
    expect(await response.json()).toEqual(uploaded)
    const [input] = fake.console.files.upload.post.mock.calls[0]!
    expect(input.body.file).toBeInstanceOf(File)
    await expect(fake()).resolves.toBeUndefined()
  })

  it('accepts a form body when one of the body variants is an upload', async () => {
    // `apps/imports` takes either a JSON DSL payload or a form with the DSL file.
    const imported = { id: 'import-1', status: 'completed' as const }
    const fake = installFakeApi({ console: { apps: { imports: { post: () => imported } } } })
    const body = new FormData()
    body.set('file', new File(['version: 0.7.0'], 'app.yml', { type: 'application/yaml' }))
    const response = await fetch('http://localhost:5001/console/api/apps/imports', {
      method: 'POST',
      body,
    })

    expect(response.ok).toBe(true)
    const [input] = fake.console.apps.imports.post.mock.calls[0]!
    expect((input.body as { file: unknown }).file).toBeInstanceOf(File)
    await expect(fake()).resolves.toBeUndefined()
  })

  it.each([
    ['without a Content-Type', new Blob([JSON.stringify(groupBody)]), /without a Content-Type/],
    ['as text/json', new Blob([JSON.stringify(groupBody)], { type: 'text/json' }), /as text\/json/],
  ])(
    'fails the test when a JSON body is sent %s, which the API ignores',
    async (_, body, sentAs) => {
      const fake = groupsApi()
      const response = await fetch(groupsUrl, { method: 'POST', body })

      expect(response.status).toBe(415)
      expect(fake.console.workspaces.current.networkAccessGroups.post).not.toHaveBeenCalled()
      await expect(fake()).rejects.toThrow(
        new RegExp(
          `workspaces\\.current\\.networkAccessGroups\\.post: sent a body ${sentAs.source}; the API reads only application/json`,
        ),
      )
    },
  )

  it('reads application/*+json bodies as JSON, as Flask does', async () => {
    const fake = groupsApi()
    const response = await fetch(groupsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/merge-patch+json; charset=utf-8' },
      body: JSON.stringify(groupBody),
    })

    expect(response.status).toBe(201)
    expect(
      fake.console.workspaces.current.networkAccessGroups.post,
    ).toHaveBeenCalledExactlyOnceWith({
      // The handler gets the validated body, with its defaults filled in.
      body: { ...groupBody, description: '' },
    })
    await expect(fake()).resolves.toBeUndefined()
  })

  it('fails the test on a trailing slash the API routes do not declare', async () => {
    const fake = groupsApi()
    await fetch(`${groupsUrl}/`)

    await expect(fake()).rejects.toThrow(
      /GET \/console\/api\/workspaces\/current\/network-access-groups\/: trailing slash/,
    )
  })
})

describe('REST route bodies', () => {
  const upload = () =>
    installFakeApi({
      routes: [route('POST', 'console', '/forgot-password/validity', ({ body }) => ({ body }))],
    })
  const url = 'http://localhost:5001/console/api/forgot-password/validity'

  it('fails the test when a body declared as JSON cannot be parsed', async () => {
    const fake = upload()
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"email": "a@example.com"',
    })

    expect(response.status).toBe(400)
    await expect(fake()).rejects.toThrow(
      /POST \/console\/api\/forgot-password\/validity: request could not be decoded: JSON body/,
    )
  })

  it('passes text bodies through as sent, without guessing JSON', async () => {
    const fake = upload()
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{"email": "a@example.com"}',
    })

    expect(await response.json()).toEqual({ body: '{"email": "a@example.com"}' })
    await fake()
  })
})

describe('hold release', () => {
  it('answers the held request with the regular implementation once released', async () => {
    let groups = [createNetworkAccessGroupFixture()]
    const fake = installFakeApi({
      console: {
        workspaces: { current: { networkAccessGroups: { get: () => ({ ...groupList, groups }) } } },
      },
    })
    const request = hold(fake.console.workspaces.current.networkAccessGroups.get)
    const response = consoleClient.workspaces.current.networkAccessGroups.get({})
    await request.arrived
    groups = []
    request.release()

    expect((await response).groups).toEqual([])
    await fake()
  })
})

describe('setupFakeApi', () => {
  const fake = setupFakeApi(() => ({
    console: { workspaces: { current: { networkAccessGroups: { get: () => groupList } } } },
  }))

  it('installs a fresh fake for each test', async () => {
    await consoleClient.workspaces.current.networkAccessGroups.get({})
    expect(fake.console.workspaces.current.networkAccessGroups.get).toHaveBeenCalledOnce()
  })

  it('does not carry spies over from the previous test', () => {
    expect(fake.console.workspaces.current.networkAccessGroups.get).not.toHaveBeenCalled()
  })
})
