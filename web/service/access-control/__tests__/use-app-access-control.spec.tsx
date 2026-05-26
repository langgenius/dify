import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider, queryOptions } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { AccessMode } from '@/models/access-control'
import { get, post } from '@/service/base'
import { getUserCanAccess } from '@/service/share'
import {
  useAppWhiteListSubjects,
  useGetUserCanAccessApp,
  useSearchForWhiteListCandidates,
  useUpdateAccessMode,
} from '../use-app-access-control'

const mockSystemFeatures = vi.hoisted(() => ({
  webappAuthEnabled: false,
}))

vi.mock('@/service/base', () => ({
  get: vi.fn(),
  post: vi.fn(),
}))

vi.mock('@/service/share', () => ({
  getUserCanAccess: vi.fn(),
}))

vi.mock('@/service/system-features', () => ({
  systemFeaturesQueryOptions: () => queryOptions({
    queryKey: ['system-features'],
    queryFn: () => Promise.resolve({
      webapp_auth: {
        enabled: mockSystemFeatures.webappAuthEnabled,
      },
    }),
  }),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('use-app-access-control', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSystemFeatures.webappAuthEnabled = false
    vi.mocked(get).mockResolvedValue({ groups: [], members: [] })
    vi.mocked(post).mockResolvedValue({})
    vi.mocked(getUserCanAccess).mockResolvedValue({ result: true })
  })

  // Queries build the enterprise whitelist endpoints from app and filter inputs.
  describe('Queries', () => {
    it('should fetch app whitelist subjects when enabled', async () => {
      renderHook(() => useAppWhiteListSubjects('app-1', true), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(get).toHaveBeenCalledWith('/enterprise/webapp/app/subjects?appId=app-1')
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
        () => useSearchForWhiteListCandidates({
          keyword: 'team one',
          groupId: 'group-1',
          resultsPerPage: 20,
        }, true),
        { wrapper: createWrapper() },
      )

      await waitFor(() => {
        expect(get).toHaveBeenCalledWith('/enterprise/webapp/app/subject/search?keyword=team+one&groupId=group-1&resultsPerPage=20&pageNumber=1')
      })
    })

    it('should return public access when webapp auth is disabled', async () => {
      const { result } = renderHook(() => useGetUserCanAccessApp({ appId: 'app-1' }), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.data).toEqual({ result: true })
      })
      expect(getUserCanAccess).not.toHaveBeenCalled()
    })

    it('should call share access check when webapp auth is enabled', async () => {
      mockSystemFeatures.webappAuthEnabled = true

      renderHook(() => useGetUserCanAccessApp({ appId: 'app-1', isInstalledApp: false }), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(getUserCanAccess).toHaveBeenCalledWith('app-1', false)
      })
    })
  })

  // Mutations submit access mode changes through the enterprise access-mode route.
  describe('Mutations', () => {
    it('should update access mode with selected subjects', async () => {
      const { result } = renderHook(() => useUpdateAccessMode(), { wrapper: createWrapper() })

      await act(async () => {
        await result.current.mutateAsync({
          appId: 'app-1',
          accessMode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
          subjects: [{ subjectId: 'account-1', subjectType: 'account' }],
        })
      })

      expect(post).toHaveBeenCalledWith('/enterprise/webapp/app/access-mode', {
        body: {
          appId: 'app-1',
          accessMode: AccessMode.SPECIFIC_GROUPS_MEMBERS,
          subjects: [{ subjectId: 'account-1', subjectType: 'account' }],
        },
      })
    })
  })
})
