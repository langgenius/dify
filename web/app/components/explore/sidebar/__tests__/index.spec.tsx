import type { InstalledAppResponse } from '@dify/contracts/api/console/installed-apps/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import SideBar from '../index'

const mocks = vi.hoisted(() => ({
  fetchNextPage: vi.fn(),
  installedApps: [] as InstalledAppResponse[],
  hasNextPage: false,
  uninstall: vi.fn(),
  updatePinStatus: vi.fn(),
  toastSuccess: vi.fn(),
}))

let intersectionCallback: IntersectionObserverCallback | undefined

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/',
  useSelectedLayoutSegments: () => ['apps'],
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    systemFeatures: {
      get: {
        queryKey: () => ['system-features'],
        queryOptions: () => ({
          queryKey: ['system-features'],
          queryFn: () => new Promise(() => {}),
        }),
      },
    },
    installedApps: {
      get: {
        infiniteOptions: (options: {
          getNextPageParam: (page: {
            has_more: boolean
            next_cursor: string | null
          }) => string | undefined
          initialPageParam: undefined
          input: (pageParam: string | undefined) => unknown
          select?: (data: unknown) => unknown
        }) => ({
          ...options,
          queryKey: ['installed-apps'],
          queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
            if (pageParam) mocks.fetchNextPage(pageParam)
            return {
              installed_apps: pageParam ? [] : mocks.installedApps,
              has_more: pageParam ? false : mocks.hasNextPage,
              next_cursor: pageParam || !mocks.hasNextPage ? null : 'next-page',
            }
          },
        }),
      },
      byInstalledAppId: {
        delete: {
          mutationOptions: () => ({
            mutationFn: (input: unknown) => mocks.uninstall(input),
          }),
        },
        patch: {
          mutationOptions: () => ({
            mutationFn: (input: unknown) => mocks.updatePinStatus(input),
          }),
        },
      },
    },
  },
}))

vi.mock('@langgenius/dify-ui/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@langgenius/dify-ui/toast')>()
  return {
    ...actual,
    toast: {
      ...actual.toast,
      success: mocks.toastSuccess,
    },
  }
})

const createInstalledApp = (
  overrides: Partial<InstalledAppResponse> = {},
): InstalledAppResponse => ({
  id: overrides.id ?? 'installed-app-1',
  app_owner_tenant_id: overrides.app_owner_tenant_id ?? 'tenant-1',
  editable: overrides.editable ?? true,
  is_pinned: overrides.is_pinned ?? false,
  last_used_at: overrides.last_used_at ?? null,
  uninstallable: overrides.uninstallable ?? false,
  app: {
    id: overrides.app?.id ?? 'app-1',
    name: overrides.app?.name ?? 'My App',
    description: overrides.app?.description ?? 'Description',
    mode: overrides.app?.mode ?? 'chat',
    icon_type: overrides.app?.icon_type ?? 'emoji',
    icon: overrides.app?.icon ?? '🤖',
    icon_background: overrides.app?.icon_background ?? '#FFFFFF',
    icon_url: overrides.app?.icon_url ?? null,
    use_icon_as_answer_icon: overrides.app?.use_icon_as_answer_icon ?? false,
  },
})

const renderSideBar = () => renderWithConsoleQuery(<SideBar />)

describe('SideBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.installedApps = []
    mocks.hasNextPage = false
    mocks.uninstall.mockResolvedValue(undefined)
    mocks.updatePinStatus.mockResolvedValue({ result: 'success', message: 'updated' })
    intersectionCallback = undefined
    vi.stubGlobal(
      'IntersectionObserver',
      class MockIntersectionObserver {
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          if (options?.root) intersectionCallback = callback
        }

        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  })

  it('renders the empty state after the installed-app query settles', async () => {
    renderSideBar()

    expect(await screen.findByText('explore.sidebar.noApps.title')).toBeInTheDocument()
  })

  it('renders installed apps and folds to icon-only navigation', async () => {
    const user = userEvent.setup()
    mocks.installedApps = [createInstalledApp()]
    renderSideBar()

    expect(await screen.findByRole('link', { name: 'My App' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'layout.sidebar.collapseSidebar' }))

    expect(screen.getByRole('button', { name: 'layout.sidebar.expandSidebar' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'My App' })).toBeInTheDocument()
  })

  it('automatically fetches the next page when the sentinel enters the scroll viewport', async () => {
    mocks.installedApps = [createInstalledApp()]
    mocks.hasNextPage = true
    renderSideBar()
    await screen.findByRole('region', { name: 'explore.sidebar.webApps' })

    expect(intersectionCallback).toBeDefined()
    act(() => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })

    await waitFor(() => expect(mocks.fetchNextPage).toHaveBeenCalledWith('next-page'))
  })

  it('uninstalls the selected app and closes the confirmation after success', async () => {
    const user = userEvent.setup()
    mocks.installedApps = [createInstalledApp()]
    renderSideBar()

    await user.click(await screen.findByRole('button', { name: 'common.operation.more' }))
    await user.click(await screen.findByText('explore.sidebar.action.delete'))
    await user.click(screen.getByText('common.operation.confirm'))

    await waitFor(() => {
      expect(mocks.uninstall).toHaveBeenCalledWith({
        params: { installed_app_id: 'installed-app-1' },
      })
      expect(mocks.toastSuccess).toHaveBeenCalledWith('common.api.remove')
    })
  })

  it('updates pin state through the generated mutation input', async () => {
    const user = userEvent.setup()
    mocks.installedApps = [createInstalledApp()]
    renderSideBar()

    await user.click(await screen.findByRole('button', { name: 'common.operation.more' }))
    await user.click(await screen.findByText('explore.sidebar.action.pin'))

    await waitFor(() =>
      expect(mocks.updatePinStatus).toHaveBeenCalledWith({
        params: { installed_app_id: 'installed-app-1' },
        body: { is_pinned: true },
      }),
    )
  })
})
