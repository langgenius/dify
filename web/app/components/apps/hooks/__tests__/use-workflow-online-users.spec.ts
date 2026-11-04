import { act, waitFor } from '@testing-library/react'
import { renderHookWithConsoleQuery } from '@/test/console/query-data'
import { useWorkflowOnlineUsers } from '../use-workflow-online-users'

const getUsers = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.workflows.onlineUsers.post': getUsers,
    }),
  }
})

const user = { user_id: 'user-1', username: 'Alice' }
describe('useWorkflowOnlineUsers', () => {
  beforeEach(() => {
    getUsers.mockReset().mockResolvedValue({ data: {} })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    { appIds: [], enabled: true },
    { appIds: ['app-1'], enabled: false },
  ])('does not request users when collaboration is unavailable (%j)', async (params) => {
    const { result } = renderHookWithConsoleQuery(() => useWorkflowOnlineUsers(params))
    await act(async () => {})
    expect(getUsers).not.toHaveBeenCalled()
    expect(result.current.onlineUsersMap).toEqual({})
  })

  it.each([{ data: [{ app_id: 'app-1', users: [user] }] }, { data: { 'app-1': [user] } }])(
    'normalizes supported response shapes through the query selector (%j)',
    async (response) => {
      getUsers.mockResolvedValue(response)
      const { result } = renderHookWithConsoleQuery(() =>
        useWorkflowOnlineUsers({ appIds: ['app-1'], enabled: true }),
      )
      expect(result.current.onlineUsersMap).toEqual({})
      await waitFor(() => expect(result.current.onlineUsersMap).toEqual({ 'app-1': [user] }))
      expect(getUsers).toHaveBeenCalledWith({ body: { app_ids: ['app-1'] } })
    },
  )

  it('polls every ten seconds and stops polling when collaboration is disabled', async () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHookWithConsoleQuery(
      ({ enabled }) => useWorkflowOnlineUsers({ appIds: ['app-1'], enabled }),
      { initialProps: { enabled: true } },
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(getUsers).toHaveBeenCalledTimes(1)
    getUsers.mockResolvedValue({ data: { 'app-1': [user] } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })
    expect(getUsers).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(result.current.onlineUsersMap).toEqual({ 'app-1': [user] })
    rerender({ enabled: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000)
    })
    expect(getUsers).toHaveBeenCalledTimes(2)
  })
})
