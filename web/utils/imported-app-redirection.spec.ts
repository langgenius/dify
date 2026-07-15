import { AppModeEnum } from '@/types/app'
import { resolveImportedAppRedirectionTarget } from './imported-app-redirection'

const mockFetchAppDetail = vi.hoisted(() => vi.fn())

vi.mock('@/service/client', () => ({
  consoleClient: {
    apps: {
      byAppId: {
        get: (...args: unknown[]) => mockFetchAppDetail(...args),
      },
    },
  },
}))

describe('resolveImportedAppRedirectionTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves the backing Agent ID for an imported Agent App', async () => {
    mockFetchAppDetail.mockResolvedValue({ bound_agent_id: 'agent-1' })

    await expect(
      resolveImportedAppRedirectionTarget({
        id: 'app-1',
        mode: AppModeEnum.AGENT,
        permission_keys: ['app.acl.view_layout'],
      }),
    ).resolves.toEqual({
      id: 'app-1',
      mode: AppModeEnum.AGENT,
      permission_keys: ['app.acl.view_layout'],
      bound_agent_id: 'agent-1',
    })
    expect(mockFetchAppDetail).toHaveBeenCalledWith({
      params: { app_id: 'app-1' },
    })
  })

  it('keeps the roster fallback when resolving the imported Agent App fails', async () => {
    mockFetchAppDetail.mockRejectedValue(new Error('Failed to fetch App detail'))
    const target = {
      id: 'app-1',
      mode: AppModeEnum.AGENT,
    }

    await expect(resolveImportedAppRedirectionTarget(target)).resolves.toEqual(target)
  })
})
