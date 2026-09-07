import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { fetchAppDetail, fetchAppList, fetchInstalledAppList } from './explore'

const mockExploreAppsGet = vi.hoisted(() => vi.fn())
const mockExploreAppDetailGet = vi.hoisted(() => vi.fn())
const mockInstalledAppsGet = vi.hoisted(() => vi.fn())

vi.mock('./client', () => ({
  consoleClient: {
    explore: {
      apps: {
        get: mockExploreAppsGet,
        byAppId: {
          get: mockExploreAppDetailGet,
        },
      },
    },
    installedApps: {
      get: mockInstalledAppsGet,
    },
  },
}))

describe('explore service normalizers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('preserves backend app modes that are not part of the legacy frontend enum', async () => {
    mockExploreAppsGet.mockResolvedValue({
      categories: [],
      recommended_apps: [
        {
          app_id: 'agent-app',
          app: {
            id: 'agent-app',
            name: 'Agent app',
            mode: 'agent',
            icon: '',
            icon_background: '',
          },
        },
      ],
    })
    mockExploreAppDetailGet.mockResolvedValue({
      id: 'pipeline-app',
      name: 'Pipeline app',
      icon: '',
      icon_background: '',
      mode: 'rag-pipeline',
      export_data: 'kind: app',
      can_trial: false,
    })

    await expect(fetchAppList()).resolves.toMatchObject({
      recommended_apps: [
        {
          app: {
            mode: 'agent',
          },
        },
      ],
    })
    await expect(fetchAppDetail('pipeline-app')).resolves.toMatchObject({
      mode: 'rag-pipeline',
    })
  })

  it('preserves installed app pagination metadata', async () => {
    mockInstalledAppsGet.mockResolvedValue({
      installed_apps: [],
      has_more: true,
      next_cursor: 'next-page',
    })

    await expect(fetchInstalledAppList()).resolves.toEqual({
      installed_apps: [],
      has_more: true,
      next_cursor: 'next-page',
    })
  })
})
