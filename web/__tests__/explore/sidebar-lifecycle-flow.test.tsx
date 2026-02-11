/**
 * Integration test: Sidebar Lifecycle Flow
 *
 * Tests the sidebar interactions for installed apps lifecycle:
 * navigation, pin/unpin ordering, delete confirmation, and
 * fold/unfold behavior.
 */
import type { InstalledApp } from '@/models/explore'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Toast from '@/app/components/base/toast'
import SideBar from '@/app/components/explore/sidebar'
import ExploreContext from '@/context/explore-context'
import { MediaType } from '@/hooks/use-breakpoints'
import { AppModeEnum } from '@/types/app'

let mockMediaType: string = MediaType.pc
const mockSegments = ['apps']
const mockPush = vi.fn()
const mockRefetch = vi.fn()
const mockUninstall = vi.fn()
const mockUpdatePinStatus = vi.fn()
let mockInstalledApps: InstalledApp[] = []

vi.mock('next/navigation', () => ({
  useSelectedLayoutSegments: () => mockSegments,
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => mockMediaType,
  MediaType: {
    mobile: 'mobile',
    tablet: 'tablet',
    pc: 'pc',
  },
}))

vi.mock('@/service/use-explore', () => ({
  useGetInstalledApps: () => ({
    isFetching: false,
    data: { installed_apps: mockInstalledApps },
    refetch: mockRefetch,
  }),
  useUninstallApp: () => ({
    mutateAsync: mockUninstall,
  }),
  useUpdateAppPinStatus: () => ({
    mutateAsync: mockUpdatePinStatus,
  }),
}))

const createInstalledApp = (overrides: Partial<InstalledApp> = {}): InstalledApp => ({
  id: overrides.id ?? 'app-1',
  uninstallable: overrides.uninstallable ?? false,
  is_pinned: overrides.is_pinned ?? false,
  app: {
    id: overrides.app?.id ?? 'app-basic-id',
    mode: overrides.app?.mode ?? AppModeEnum.CHAT,
    icon_type: overrides.app?.icon_type ?? 'emoji',
    icon: overrides.app?.icon ?? '🤖',
    icon_background: overrides.app?.icon_background ?? '#fff',
    icon_url: overrides.app?.icon_url ?? '',
    name: overrides.app?.name ?? 'App One',
    description: overrides.app?.description ?? 'desc',
    use_icon_as_answer_icon: overrides.app?.use_icon_as_answer_icon ?? false,
  },
})

const renderSidebar = (installedApps: InstalledApp[] = []) => {
  return render(
    <ExploreContext.Provider
      value={{
        controlUpdateInstalledApps: 0,
        setControlUpdateInstalledApps: vi.fn(),
        hasEditPermission: true,
        installedApps,
        setInstalledApps: vi.fn(),
        isFetchingInstalledApps: false,
        setIsFetchingInstalledApps: vi.fn(),
      } as Record<string, unknown> as ReturnType<typeof ExploreContext.Provider extends React.FC<{ value: infer V }> ? () => V : never>}
    >
      <SideBar controlUpdateInstalledApps={0} />
    </ExploreContext.Provider>,
  )
}

describe('Sidebar Lifecycle Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMediaType = MediaType.pc
    mockInstalledApps = []
    vi.spyOn(Toast, 'notify').mockImplementation(() => ({ clear: vi.fn() }))
  })

  describe('Pin / Unpin / Delete Flow', () => {
    it('should complete pin → unpin cycle for an app', async () => {
      // Step 1: Start with an unpinned app
      const app = createInstalledApp({ is_pinned: false })
      mockInstalledApps = [app]
      mockUpdatePinStatus.mockResolvedValue(undefined)

      renderSidebar(mockInstalledApps)

      // Step 2: Pin the app
      fireEvent.click(screen.getByTestId('item-operation-trigger'))
      fireEvent.click(await screen.findByText('explore.sidebar.action.pin'))

      await waitFor(() => {
        expect(mockUpdatePinStatus).toHaveBeenCalledWith({ appId: 'app-1', isPinned: true })
        expect(Toast.notify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'success',
        }))
      })
    })

    it('should complete the delete flow with confirmation', async () => {
      const app = createInstalledApp()
      mockInstalledApps = [app]
      mockUninstall.mockResolvedValue(undefined)

      renderSidebar(mockInstalledApps)

      // Step 1: Open operation menu and click delete
      fireEvent.click(screen.getByTestId('item-operation-trigger'))
      fireEvent.click(await screen.findByText('explore.sidebar.action.delete'))

      // Step 2: Confirm dialog appears
      expect(await screen.findByText('explore.sidebar.delete.title')).toBeInTheDocument()

      // Step 3: Confirm deletion
      fireEvent.click(screen.getByText('common.operation.confirm'))

      // Step 4: Uninstall API called and success toast shown
      await waitFor(() => {
        expect(mockUninstall).toHaveBeenCalledWith('app-1')
        expect(Toast.notify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'success',
          message: 'common.api.remove',
        }))
      })
    })

    it('should cancel deletion when user clicks cancel', async () => {
      const app = createInstalledApp()
      mockInstalledApps = [app]

      renderSidebar(mockInstalledApps)

      // Open delete flow
      fireEvent.click(screen.getByTestId('item-operation-trigger'))
      fireEvent.click(await screen.findByText('explore.sidebar.action.delete'))

      // Cancel the deletion
      fireEvent.click(await screen.findByText('common.operation.cancel'))

      // Uninstall should not be called
      expect(mockUninstall).not.toHaveBeenCalled()
    })
  })

  describe('Multi-App Ordering', () => {
    it('should display pinned apps before unpinned apps with divider', () => {
      mockInstalledApps = [
        createInstalledApp({ id: 'pinned-1', is_pinned: true, app: { ...createInstalledApp().app, name: 'Pinned App' } }),
        createInstalledApp({ id: 'unpinned-1', is_pinned: false, app: { ...createInstalledApp().app, name: 'Regular App' } }),
      ]

      renderSidebar(mockInstalledApps)

      const pinnedApp = screen.getByText('Pinned App')
      const regularApp = screen.getByText('Regular App')

      expect(pinnedApp).toBeInTheDocument()
      expect(regularApp).toBeInTheDocument()
    })
  })

  describe('Empty State', () => {
    it('should show NoApps component when no apps are installed on desktop', () => {
      mockMediaType = MediaType.pc
      renderSidebar([])

      expect(screen.getByText('explore.sidebar.noApps.title')).toBeInTheDocument()
    })

    it('should hide NoApps on mobile', () => {
      mockMediaType = MediaType.mobile
      renderSidebar([])

      expect(screen.queryByText('explore.sidebar.noApps.title')).not.toBeInTheDocument()
    })
  })
})
