import {
  createConsoleQueryClient,
  renderHookWithConsoleQuery,
  seedAppDetail,
} from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppModeEnum } from '@/types/app'
import { useIsChatMode } from '../use-is-chat-mode'

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
}))

const renderWithAppMode = (mode: AppModeEnum) => {
  const queryClient = createConsoleQueryClient()
  seedAppDetail(queryClient, createAppDetailFixture({ id: 'app-1', mode }))
  return renderHookWithConsoleQuery(() => useIsChatMode(), { queryClient })
}

describe('useIsChatMode', () => {
  it('should return true when the app mode is ADVANCED_CHAT', () => {
    const { result } = renderWithAppMode(AppModeEnum.ADVANCED_CHAT)

    expect(result.current).toBe(true)
  })

  it('should return false when the app mode is WORKFLOW', () => {
    const { result } = renderWithAppMode(AppModeEnum.WORKFLOW)

    expect(result.current).toBe(false)
  })
})
