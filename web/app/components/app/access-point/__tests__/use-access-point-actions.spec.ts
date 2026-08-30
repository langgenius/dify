import { toast } from '@langgenius/dify-ui/toast'
import { act } from '@testing-library/react'
import { renderHookWithConsoleQuery } from '@/test/console/query-data'
import { useAccessPointActions } from '../shared/use-access-point-actions'

const mocks = vi.hoisted(() => ({
  fetchAppDetail: vi.fn().mockResolvedValue({}),
  setAppDetail: vi.fn(),
  updateAppSiteAccessToken: vi.fn().mockResolvedValue({ app_id: 'app-1' }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({ toast: vi.fn() }))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { setAppDetail: typeof mocks.setAppDetail }) => unknown) =>
    selector({ setAppDetail: mocks.setAppDetail }),
}))

vi.mock('@/service/apps', () => ({
  fetchAppDetail: mocks.fetchAppDetail,
  updateAppSiteAccessToken: mocks.updateAppSiteAccessToken,
  updateAppSiteConfig: vi.fn(),
}))

describe('useAccessPointActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps success feedback for explicit URL regeneration', async () => {
    const { result } = renderHookWithConsoleQuery(() => useAccessPointActions('app-1', true))

    await act(() => result.current.regenerateSiteCode())

    expect(mocks.updateAppSiteAccessToken).toHaveBeenCalledWith({
      url: '/apps/app-1/site/access-token-reset',
    })
    expect(toast).toHaveBeenCalledWith('common.actionMsg.generatedSuccessfully', {
      type: 'success',
    })
  })
})
