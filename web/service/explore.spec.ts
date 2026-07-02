import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchAppDetail,
  fetchAppList,
  fetchInstalledAppMeta,
} from './explore'

const mockExploreAppsGet = vi.hoisted(() => vi.fn())
const mockExploreAppDetailGet = vi.hoisted(() => vi.fn())
const mockInstalledAppMetaGet = vi.hoisted(() => vi.fn())

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
      byInstalledAppId: {
        meta: {
          get: mockInstalledAppMetaGet,
        },
      },
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
      recommended_apps: [{
        app_id: 'agent-app',
        app: {
          id: 'agent-app',
          name: 'Agent app',
          mode: 'agent',
          icon: '',
          icon_background: '',
        },
      }],
    })
    mockExploreAppDetailGet.mockResolvedValue({
      id: 'pipeline-app',
      name: 'Pipeline app',
      icon: '',
      icon_background: '',
      mode: 'rag-pipeline',
      export_data: 'kind: app',
    })

    await expect(fetchAppList()).resolves.toMatchObject({
      recommended_apps: [{
        app: {
          mode: 'agent',
        },
      }],
    })
    await expect(fetchAppDetail('pipeline-app')).resolves.toMatchObject({
      mode: 'rag-pipeline',
    })
  })

  it('preserves provider-defined tool icon payload objects', async () => {
    const providerIcon = {
      type: 'custom',
      value: {
        content: 'tool',
        background: '#fff',
      },
    }
    mockInstalledAppMetaGet.mockResolvedValue({
      tool_icons: {
        builtin: '/tool.svg',
        provider: providerIcon,
      },
    })

    await expect(fetchInstalledAppMeta('installed-app-id')).resolves.toEqual({
      tool_icons: {
        builtin: '/tool.svg',
        provider: providerIcon,
      },
    })
  })
})
