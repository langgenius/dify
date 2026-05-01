import { fetchWorkflowOnlineUsers } from '../apps'
import { consoleClient } from '../client'

vi.mock('../client', () => ({
  consoleClient: {
    apps: {
      workflowOnlineUsers: vi.fn(),
    },
  },
}))

vi.mock('@/utils/var', () => ({
  basePath: '/app',
  API_PREFIX: '/console/api',
  PUBLIC_API_PREFIX: '/api',
  IS_CE_EDITION: false,
}))

describe('fetchWorkflowOnlineUsers', () => {
  const workflowOnlineUsers = vi.mocked(consoleClient.apps.workflowOnlineUsers)

  beforeEach(() => {
    workflowOnlineUsers.mockReset()
  })

  it('returns empty result without requesting when app ids are empty', async () => {
    await expect(fetchWorkflowOnlineUsers({ appIds: [] })).resolves.toEqual({})

    expect(workflowOnlineUsers).not.toHaveBeenCalled()
  })

  it('fetches workflow online users in batches of 50 app ids', async () => {
    const appIds = Array.from({ length: 51 }, (_, index) => `app-${index + 1}`)

    workflowOnlineUsers
      .mockResolvedValueOnce({
        data: {
          'app-1': [{ user_id: 'user-1', username: 'Alice' }],
          'app-50': [{ user_id: 'user-50', username: 'Bob' }],
        },
      })
      .mockResolvedValueOnce({
        data: [{
          app_id: 'app-51',
          users: [{ user_id: 'user-51', username: 'Carol' }],
        }],
      })

    await expect(fetchWorkflowOnlineUsers({ appIds })).resolves.toEqual({
      'app-1': [{ user_id: 'user-1', username: 'Alice' }],
      'app-50': [{ user_id: 'user-50', username: 'Bob' }],
      'app-51': [{ user_id: 'user-51', username: 'Carol' }],
    })

    expect(workflowOnlineUsers).toHaveBeenCalledTimes(2)
    expect(workflowOnlineUsers).toHaveBeenNthCalledWith(1, {
      query: { app_ids: appIds.slice(0, 50).join(',') },
    })
    expect(workflowOnlineUsers).toHaveBeenNthCalledWith(2, {
      query: { app_ids: appIds.slice(50).join(',') },
    })
  })
})
