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
  it('serializes ids as repeated query params', async () => {
    vi.mocked(consoleClient.trialApps.byAppId.datasets.get).mockResolvedValue({ data: [] })

    await fetchTryAppDatasets('app-1', ['id-1', 'id-2'])

    expect(consoleClient.trialApps.byAppId.datasets.get).toHaveBeenCalledWith({
      params: { app_id: 'app-1' },
      query: { ids: ['id-1', 'id-2'] },
    })
  })
})
