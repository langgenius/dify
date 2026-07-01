import { consoleClient } from '@/service/client'
import { fetchTryAppDatasets } from './try-app'

vi.mock('@/service/client', () => ({
  consoleClient: {
    trialApps: {
      byAppId: {
        datasets: {
          get: vi.fn(),
        },
      },
    },
  },
}))

describe('fetchTryAppDatasets', () => {
  it('passes ids to the generated client', async () => {
    vi.mocked(consoleClient.trialApps.byAppId.datasets.get).mockResolvedValue({
      data: [],
      has_more: false,
      limit: 20,
      page: 1,
      total: 0,
    })

    await fetchTryAppDatasets('app-1', ['id-1', 'id-2'])

    expect(consoleClient.trialApps.byAppId.datasets.get).toHaveBeenCalledWith({
      params: { app_id: 'app-1' },
      query: { ids: ['id-1', 'id-2'] },
    })
  })
})
