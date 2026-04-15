import { get } from './base'
import { fetchTryAppDatasets } from './try-app'

vi.mock('./base', () => ({
  get: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    trialApps: {
      info: vi.fn(),
      workflows: vi.fn(),
      parameters: vi.fn(),
    },
  },
}))

describe('fetchTryAppDatasets', () => {
  it('serializes ids as repeated query params', async () => {
    vi.mocked(get).mockResolvedValue({ data: [] })

    await fetchTryAppDatasets('app-1', ['id-1', 'id-2'])

    expect(get).toHaveBeenCalledWith('/trial-apps/app-1/datasets?ids=id-1&ids=id-2')
  })
})
