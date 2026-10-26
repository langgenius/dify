import { act, renderHook, waitFor } from '@testing-library/react'
import { request } from '@/service/base'
import { getUserCanAccess } from '@/service/share'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import {
  useAppWhiteListSubjects,
  useGetUserCanAccessApp,
  useSearchForWhiteListCandidates,
} from '../use-app-access-control'

const mockSystemFeatures = vi.hoisted(() => ({
  webappAuthEnabled: false,
}))
const { mockGetWebAppWhitelistSubjects } = vi.hoisted(() => ({
  mockGetWebAppWhitelistSubjects: vi.fn(),
}))

vi.mock('@/service/base', () => ({
  request: vi.fn(),
}))

vi.mock('@/service/share', () => ({
  getUserCanAccess: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'enterprise.webAppAuth.getWebAppWhitelistSubjects': mockGetWebAppWhitelistSubjects,
    }),
  }
})

const createWrapper = () =>
  createConsoleQueryWrapper({
    systemFeatures: {
      webapp_auth: {
        enabled: mockSystemFeatures.webappAuthEnabled,
      },
    },
  }).wrapper

describe('use-app-access-control', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSystemFeatures.webappAuthEnabled = false
    vi.mocked(request).mockReset()
    mockGetWebAppWhitelistSubjects.mockResolvedValue({ groups: [], members: [] })
    vi.mocked(getUserCanAccess).mockResolvedValue({ result: true })
  })

  // Queries build the enterprise whitelist endpoints from app and filter inputs.
  describe('Queries', () => {
    it('should fetch app whitelist subjects when enabled', async () => {
      mockGetWebAppWhitelistSubjects.mockResolvedValue({
        groups: [{ id: 'group-1', name: 'Engineering', groupSize: 3 }],
        members: [
          {
            id: 'member-1',
            name: 'Ada',
            email: 'ada@example.com',
            avatar: 'avatar-url',
          },
        ],
      })
      const { result } = renderHook(() => useAppWhiteListSubjects('app-1', true), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.data).toEqual({
          groups: [{ id: 'group-1', name: 'Engineering', groupSize: 3 }],
          members: [
            {
              id: 'member-1',
              name: 'Ada',
              email: 'ada@example.com',
              avatar: 'avatar-url',
              avatarUrl: 'avatar-url',
            },
          ],
        })
      })
      expect(mockGetWebAppWhitelistSubjects).toHaveBeenCalledWith({
        query: { appId: 'app-1' },
      })
    })

    it('searches and paginates candidates with generated query parameters', async () => {
      vi.mocked(request)
        .mockResolvedValueOnce(Response.json({ subjects: [], hasMore: true }))
        .mockResolvedValueOnce(Response.json({ subjects: [], currPage: 2, hasMore: false }))
      const { result } = renderHook(
        () =>
          useSearchForWhiteListCandidates(
            {
              keyword: 'team one',
              groupId: 'group-1',
              resultsPerPage: 20,
            },
            true,
          ),
        { wrapper: createWrapper() },
      )
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.hasNextPage).toBe(true)
      await act(async () => {
        const next = await result.current.fetchNextPage()
        expect(next.error).toBeNull()
        expect(next.data?.pages).toHaveLength(2)
      })
      await waitFor(() => expect(result.current.data?.pages).toHaveLength(2))
      const urls = vi.mocked(request).mock.calls.map(([url]) => new URL(url))
      expect(urls.map((url) => url.searchParams.get('pageNumber'))).toEqual(['1', '2'])
      for (const url of urls) {
        expect(url.pathname).toContain('/enterprise/webapp/app/subject/search')
        expect(url.searchParams.get('keyword')).toBe('team one')
        expect(url.searchParams.get('groupId')).toBe('group-1')
        expect(url.searchParams.get('resultsPerPage')).toBe('20')
      }
      expect(result.current.hasNextPage).toBe(false)
    })

    it('selects usable members and groups without inventing missing identities', async () => {
      vi.mocked(request).mockResolvedValue(
        Response.json({
          subjects: [
            {
              subjectId: 'member-1',
              subjectType: 'account',
              accountData: {
                id: 'member-1',
                name: 'Ada',
                email: 'ada@example.com',
                avatar: 'avatar-url',
              },
            },
            {
              subjectId: 'group-1',
              subjectType: 'group',
              groupData: { id: 'group-1', name: 'Engineering' },
            },
            { subjectId: 'missing-data', subjectType: 'account' },
            { subjectId: 'unknown-type', subjectType: 'other' },
            { subjectType: 'group', groupData: { id: 'missing-subject', name: 'Other' } },
          ],
        }),
      )
      const { result } = renderHook(() => useSearchForWhiteListCandidates({}, true), {
        wrapper: createWrapper(),
      })
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data?.pages[0]?.subjects).toEqual([
        {
          subjectId: 'member-1',
          subjectType: 'account',
          accountData: {
            id: 'member-1',
            name: 'Ada',
            email: 'ada@example.com',
            avatar: 'avatar-url',
            avatarUrl: 'avatar-url',
          },
        },
        {
          subjectId: 'group-1',
          subjectType: 'group',
          groupData: { id: 'group-1', name: 'Engineering', groupSize: 0 },
        },
      ])
    })

    it('does not request candidates while disabled and separates search caches', async () => {
      vi.mocked(request).mockImplementation(async () =>
        Response.json({ subjects: [], currPage: 1, hasMore: false }),
      )
      const { result, rerender } = renderHook(
        ({ enabled, keyword }) => useSearchForWhiteListCandidates({ keyword }, enabled),
        {
          initialProps: { enabled: false, keyword: 'first' },
          wrapper: createWrapper(),
        },
      )
      expect(request).not.toHaveBeenCalled()
      rerender({ enabled: true, keyword: 'first' })
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      rerender({ enabled: true, keyword: 'second' })
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(
        vi.mocked(request).mock.calls.map(([url]) => new URL(url).searchParams.get('keyword')),
      ).toEqual(['first', 'second'])
    })

    it('should return public access when webapp auth is disabled', async () => {
      const { result } = renderHook(() => useGetUserCanAccessApp({ appId: 'app-1' }), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.data).toEqual({ result: true })
      })
      expect(getUserCanAccess).not.toHaveBeenCalled()
    })

    it('should call share access check when webapp auth is enabled', async () => {
      mockSystemFeatures.webappAuthEnabled = true

      vi.mocked(getUserCanAccess).mockResolvedValue({ result: false })
      const { result } = renderHook(
        () => useGetUserCanAccessApp({ appId: 'app-1', isInstalledApp: false }),
        {
          wrapper: createWrapper(),
        },
      )

      await waitFor(() => {
        expect(result.current.data).toEqual({ result: false })
        expect(getUserCanAccess).toHaveBeenCalledWith('app-1', false)
      })
    })
  })
})
