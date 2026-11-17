import type {
  LimitationModel,
  VectorSpaceLimitationModel,
} from '@dify/contracts/api/console/features/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { getKnowledgeFsUploadQuotaFailure } from '../quota'

const request = vi.hoisted(() => vi.fn())

vi.mock('@/service/base', () => ({ request }))

describe('KnowledgeFS upload quota preflight', () => {
  let queryClient: QueryClient
  let documents: LimitationModel
  let vectorSpace: VectorSpaceLimitationModel

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 300_000, gcTime: Infinity, retry: 2, retryDelay: 0 },
      },
    })
    documents = { size: 4, limit: 5 }
    vectorSpace = { size: 4, limit: 10 }
    request.mockReset()
    request.mockImplementation(async (url: string) =>
      Response.json(
        url.endsWith('/features/vector-space')
          ? vectorSpace
          : { documents_upload_quota: documents },
      ),
    )
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    queryClient.clear()
    vi.restoreAllMocks()
  })

  it('allows uploads with remaining capacity and makes both requests silent', async () => {
    await expect(getKnowledgeFsUploadQuotaFailure(queryClient)).resolves.toBeUndefined()

    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/console/api/features',
      '/console/api/features/vector-space',
    ])
    for (const call of request.mock.calls) expect(call[2]).toMatchObject({ silent: true })
  })

  it.each([
    { size: 5, limit: 5 },
    { size: 6, limit: 5 },
    { size: 0, limit: 0 },
  ])('rejects exhausted document quota %j before querying vector usage', async (quota) => {
    documents = quota

    await expect(getKnowledgeFsUploadQuotaFailure(queryClient)).resolves.toBe(
      'taskFailure.documentCountQuotaExceeded',
    )
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each([
    { size: 10, limit: 10 },
    { size: 11, limit: 10 },
    { size: 0, limit: 0 },
  ])('rejects exhausted vector quota %j', async (quota) => {
    vectorSpace = quota

    await expect(getKnowledgeFsUploadQuotaFailure(queryClient)).resolves.toBe(
      'taskFailure.vectorSpaceQuotaExceeded',
    )
  })

  it('allows unlimited document and vector quotas', async () => {
    documents = { size: 100, limit: -1 }
    vectorSpace = { size: 100, limit: -1 }

    await expect(getKnowledgeFsUploadQuotaFailure(queryClient)).resolves.toBeUndefined()
  })

  it('does not interpret unknown vector usage as available capacity', async () => {
    vectorSpace = { size: 0, limit: 10, usage_unknown: true }

    await expect(getKnowledgeFsUploadQuotaFailure(queryClient)).resolves.toBe(
      'taskFailure.vectorSpaceQuotaUnavailable',
    )
  })

  it('reports document quota lookup failure without retrying or querying vector usage', async () => {
    request.mockRejectedValue(new Error('Service unavailable'))

    await expect(getKnowledgeFsUploadQuotaFailure(queryClient)).resolves.toBe(
      'taskFailure.documentCountQuotaUnavailable',
    )
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('reports vector quota lookup failure without retrying', async () => {
    request
      .mockResolvedValueOnce(Response.json({ documents_upload_quota: documents }))
      .mockRejectedValue(new Error('Service unavailable'))

    await expect(getKnowledgeFsUploadQuotaFailure(queryClient)).resolves.toBe(
      'taskFailure.vectorSpaceQuotaUnavailable',
    )
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('rechecks current document usage even when the query cache is still fresh', async () => {
    await expect(getKnowledgeFsUploadQuotaFailure(queryClient)).resolves.toBeUndefined()
    documents = { size: 5, limit: 5 }

    await expect(getKnowledgeFsUploadQuotaFailure(queryClient)).resolves.toBe(
      'taskFailure.documentCountQuotaExceeded',
    )
    expect(request).toHaveBeenCalledTimes(3)
    expect(
      queryClient.getQueryData(consoleQuery.features.get.queryKey())?.documents_upload_quota,
    ).toEqual(documents)
  })

  it('rechecks current vector usage even when the query cache is still fresh', async () => {
    await expect(getKnowledgeFsUploadQuotaFailure(queryClient)).resolves.toBeUndefined()
    vectorSpace = { size: 10, limit: 10 }

    await expect(getKnowledgeFsUploadQuotaFailure(queryClient)).resolves.toBe(
      'taskFailure.vectorSpaceQuotaExceeded',
    )
    expect(request).toHaveBeenCalledTimes(4)
  })
})
