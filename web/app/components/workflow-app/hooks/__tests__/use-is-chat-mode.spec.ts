import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  renderHookWithConsoleQuery,
  seedAppDetail,
} from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppModeEnum } from '@/types/app'
import { useIsChatMode } from '../use-is-chat-mode'

const { mockParams } = vi.hoisted(() => ({
  mockParams: { current: {} as { appId?: string } },
}))

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => mockParams.current,
}))

const renderWithAppMode = (mode: AppModeEnum) => {
  const queryClient = createConsoleQueryClient()
  seedAppDetail(queryClient, createAppDetailFixture({ id: 'app-1', mode }))
  return renderHookWithConsoleQuery(() => useIsChatMode(), { queryClient })
}

describe('useIsChatMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockParams.current = { appId: 'app-1' }
  })

  it('should return true when the app mode is ADVANCED_CHAT', () => {
    const { result } = renderWithAppMode(AppModeEnum.ADVANCED_CHAT)

    expect(result.current).toBe(true)
  })

  it('should return false when the app mode is WORKFLOW', () => {
    const { result } = renderWithAppMode(AppModeEnum.WORKFLOW)

    expect(result.current).toBe(false)
  })

  it('should return false without requesting app detail when there is no appId route param', () => {
    mockParams.current = {}

    const { result, queryClient } = renderHookWithConsoleQuery(() => useIsChatMode())

    expect(result.current).toBe(false)
    const appDetailQueries = queryClient
      .getQueryCache()
      .findAll({ queryKey: consoleQuery.apps.byAppId.get.key() })
    expect(appDetailQueries.every((query) => query.state.dataUpdateCount === 0)).toBe(true)
  })
})
