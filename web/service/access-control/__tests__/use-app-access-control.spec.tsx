import { renderHook, waitFor } from '@testing-library/react'
import { get } from '@/service/base'
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
  get: vi.fn(),
  request: vi.fn(),
}))

vi.mock('@/service/share', () => ({
  getUserCanAccess: vi.fn(),
}))

vi.mock('@/service/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/client')>()
  return {
    ...actual,
    consoleQuery: {
      ...actual.consoleQuery,
      systemFeatures: actual.consoleQuery.systemFeatures,
      enterprise: {
        ...actual.consoleQuery.enterprise,
        webAppAuth: {
          ...actual.consoleQuery.enterprise.webAppAuth,
          getWebAppWhitelistSubjects: {
            queryOptions: ({ input }: { input: { query: { appId?: string } } }) => ({
              queryKey: ['web-app-whitelist-subjects', input.query.appId],
              queryFn: () => mockGetWebAppWhitelistSubjects(input),
            }),
          },
        },
      },
    },
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
    vi.mocked(get).mockResolvedValue({ groups: [], members: [] })
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

    it('should search whitelist candidates with encoded query params', async () => {
      vi.mocked(get).mockResolvedValue({
        currPage: 1,
        totalPages: 1,
        subjects: [],
        hasMore: false,
      })

      renderHook(
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

      await waitFor(() => {
        expect(get).toHaveBeenCalledWith(
          '/enterprise/webapp/app/subject/search?keyword=team+one&groupId=group-1&resultsPerPage=20&pageNumber=1',
        )
      })
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

      renderHook(() => useGetUserCanAccessApp({ appId: 'app-1', isInstalledApp: false }), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(getUserCanAccess).toHaveBeenCalledWith('app-1', false)
      })
    })
  })
})
