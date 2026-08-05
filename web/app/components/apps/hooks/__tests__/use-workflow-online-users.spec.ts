import type { WorkflowOnlineUser, WorkflowOnlineUsersResponse } from '@/models/app'
import { renderHook } from '@testing-library/react'
import { useWorkflowOnlineUsers } from '../use-workflow-online-users'

type QueryOptions = {
  input: {
    body: {
      app_ids: string[]
    }
  }
  enabled: boolean
  select: (response?: WorkflowOnlineUsersResponse) => Record<string, WorkflowOnlineUser[]>
  refetchInterval: false | number
}

const { mockUseQuery, mockQueryOptions } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mockQueryOptions: vi.fn((options: QueryOptions) => options),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: mockUseQuery,
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      workflows: {
        onlineUsers: {
          post: {
            queryOptions: mockQueryOptions,
          },
        },
      },
    },
  },
}))

const getLastQueryOptions = () => {
  const lastCall = mockQueryOptions.mock.lastCall
  if (!lastCall) throw new Error('workflows.onlineUsers.post.queryOptions was not called')
  return lastCall[0] as QueryOptions
}

describe('useWorkflowOnlineUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockReturnValue({ data: undefined })
  })

  describe('Query Options', () => {
    it('should disable query with a valid empty input when app ids are empty', () => {
      renderHook(() =>
        useWorkflowOnlineUsers({
          appIds: [],
          enabled: true,
        }),
      )

      expect(mockQueryOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          input: { body: { app_ids: [] } },
          enabled: false,
          refetchInterval: false,
        }),
      )
      expect(mockUseQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          input: { body: { app_ids: [] } },
          enabled: false,
        }),
      )
    })

    it('should enable query and polling when collaboration is enabled with app ids', () => {
      renderHook(() =>
        useWorkflowOnlineUsers({
          appIds: ['app-1', 'app-2'],
          enabled: true,
        }),
      )

      expect(mockQueryOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          input: { body: { app_ids: ['app-1', 'app-2'] } },
          enabled: true,
          refetchInterval: 10000,
        }),
      )
    })

    it('should disable query while preserving valid input when collaboration is disabled', () => {
      renderHook(() =>
        useWorkflowOnlineUsers({
          appIds: ['app-1'],
          enabled: false,
        }),
      )

      expect(mockQueryOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          input: { body: { app_ids: ['app-1'] } },
          enabled: false,
          refetchInterval: false,
        }),
      )
    })
  })

  describe('Response Mapping', () => {
    it('should normalize array response data by app id', () => {
      renderHook(() =>
        useWorkflowOnlineUsers({
          appIds: ['app-1'],
          enabled: true,
        }),
      )

      const options = getLastQueryOptions()
      const user = { user_id: 'user-1', username: 'Alice' }

      expect(
        options.select({
          data: [{ app_id: 'app-1', users: [user] }],
        }),
      ).toEqual({
        'app-1': [user],
      })
    })

    it('should normalize record response data without changing user arrays', () => {
      renderHook(() =>
        useWorkflowOnlineUsers({
          appIds: ['app-1'],
          enabled: true,
        }),
      )

      const options = getLastQueryOptions()
      const users = [{ user_id: 'user-1', username: 'Alice' }]

      expect(
        options.select({
          data: {
            'app-1': users,
          },
        }),
      ).toEqual({
        'app-1': users,
      })
    })
  })

  describe('Return Value', () => {
    it('should return an empty map when query data is unavailable', () => {
      const { result } = renderHook(() =>
        useWorkflowOnlineUsers({
          appIds: ['app-1'],
          enabled: true,
        }),
      )

      expect(result.current.onlineUsersMap).toEqual({})
    })
  })
})
