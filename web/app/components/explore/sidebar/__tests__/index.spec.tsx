import type { InstalledApp } from '@/models/explore'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Toast from '@/app/components/base/toast'
import { MediaType } from '@/hooks/use-breakpoints'
import { AppModeEnum } from '@/types/app'
import SideBar from '../index'

const mockSegments = ['apps']
const mockPush = vi.fn()
const mockUninstall = vi.fn()
const mockUpdatePinStatus = vi.fn()
let mockIsPending = false
let mockInstalledApps: InstalledApp[] = []
let mockMediaType: string = MediaType.pc

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
    isPending: mockIsPending,
    data: { installed_apps: mockInstalledApps },
  }),
  useUninstallApp: () => ({
    mutateAsync: mockUninstall,
  }),
  useUpdateAppPinStatus: () => ({
    mutateAsync: mockUpdatePinStatus,
  }),
}))

const createInstalledApp = (overrides: Partial<InstalledApp> = {}): InstalledApp => ({
  id: overrides.id ?? 'app-123',
  uninstallable: overrides.uninstallable ?? false,
  is_pinned: overrides.is_pinned ?? false,
  app: {
    id: overrides.app?.id ?? 'app-basic-id',
    mode: overrides.app?.mode ?? AppModeEnum.CHAT,
    icon_type: overrides.app?.icon_type ?? 'emoji',
    icon: overrides.app?.icon ?? '🤖',
    icon_background: overrides.app?.icon_background ?? '#fff',
    icon_url: overrides.app?.icon_url ?? '',
    name: overrides.app?.name ?? 'My App',
    description: overrides.app?.description ?? 'desc',
    use_icon_as_answer_icon: overrides.app?.use_icon_as_answer_icon ?? false,
  },
})

const renderSideBar = () => {
  return render(<SideBar />)
}

describe('SideBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsPending = false
    mockInstalledApps = []
    mockMediaType = MediaType.pc
    vi.spyOn(Toast, 'notify').mockImplementation(() => ({ clear: vi.fn() }))
  })

  describe('Rendering', () => {
    it('should render discovery link', () => {
      renderSideBar()

      expect(screen.getByText('explore.sidebar.title')).toBeInTheDocument()
    })

    it('should render workspace items when installed apps exist', () => {
      mockInstalledApps = [createInstalledApp()]
      renderSideBar()

      expect(screen.getByText('explore.sidebar.webApps')).toBeInTheDocument()
      expect(screen.getByText('My App')).toBeInTheDocument()
    })

    it('should render NoApps component when no installed apps on desktop', () => {
      renderSideBar()

      expect(screen.getByText('explore.sidebar.noApps.title')).toBeInTheDocument()
    })

    it('should not render NoApps while loading', () => {
      mockIsPending = true
      renderSideBar()

      expect(screen.queryByText('explore.sidebar.noApps.title')).not.toBeInTheDocument()
    })

    it('should render multiple installed apps', () => {
      mockInstalledApps = [
        createInstalledApp({ id: 'app-1', app: { ...createInstalledApp().app, name: 'Alpha' } }),
        createInstalledApp({ id: 'app-2', app: { ...createInstalledApp().app, name: 'Beta' } }),
      ]
      renderSideBar()

      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.getByText('Beta')).toBeInTheDocument()
    })

    it('should render divider between pinned and unpinned apps', () => {
      mockInstalledApps = [
        createInstalledApp({ id: 'app-1', is_pinned: true, app: { ...createInstalledApp().app, name: 'Pinned' } }),
        createInstalledApp({ id: 'app-2', is_pinned: false, app: { ...createInstalledApp().app, name: 'Unpinned' } }),
      ]
      const { container } = renderSideBar()

      const dividers = container.querySelectorAll('[class*="divider"], hr')
      expect(dividers.length).toBeGreaterThan(0)
    })
  })

  describe('User Interactions', () => {
    it('should uninstall app and show toast when delete is confirmed', async () => {
      mockInstalledApps = [createInstalledApp()]
      mockUninstall.mockResolvedValue(undefined)
      renderSideBar()

      fireEvent.click(screen.getByTestId('item-operation-trigger'))
      fireEvent.click(await screen.findByText('explore.sidebar.action.delete'))
      fireEvent.click(await screen.findByText('common.operation.confirm'))

      await waitFor(() => {
        expect(mockUninstall).toHaveBeenCalledWith('app-123')
        expect(Toast.notify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'success',
          message: 'common.api.remove',
        }))
      })
    })

    it('should update pin status and show toast when pin is clicked', async () => {
      mockInstalledApps = [createInstalledApp({ is_pinned: false })]
      mockUpdatePinStatus.mockResolvedValue(undefined)
      renderSideBar()

      fireEvent.click(screen.getByTestId('item-operation-trigger'))
      fireEvent.click(await screen.findByText('explore.sidebar.action.pin'))

      await waitFor(() => {
        expect(mockUpdatePinStatus).toHaveBeenCalledWith({ appId: 'app-123', isPinned: true })
        expect(Toast.notify).toHaveBeenCalledWith(expect.objectContaining({
          type: 'success',
          message: 'common.api.success',
        }))
      })
    })

    it('should unpin an already pinned app', async () => {
      mockInstalledApps = [createInstalledApp({ is_pinned: true })]
      mockUpdatePinStatus.mockResolvedValue(undefined)
      renderSideBar()

      fireEvent.click(screen.getByTestId('item-operation-trigger'))
      fireEvent.click(await screen.findByText('explore.sidebar.action.unpin'))

      await waitFor(() => {
        expect(mockUpdatePinStatus).toHaveBeenCalledWith({ appId: 'app-123', isPinned: false })
      })
    })

    it('should open and close confirm dialog for delete', async () => {
      mockInstalledApps = [createInstalledApp()]
      renderSideBar()

      fireEvent.click(screen.getByTestId('item-operation-trigger'))
      fireEvent.click(await screen.findByText('explore.sidebar.action.delete'))

      expect(await screen.findByText('explore.sidebar.delete.title')).toBeInTheDocument()

      fireEvent.click(screen.getByText('common.operation.cancel'))

      await waitFor(() => {
        expect(mockUninstall).not.toHaveBeenCalled()
      })
    })
  })

  describe('Edge Cases', () => {
    it('should hide NoApps and app names on mobile', () => {
      mockMediaType = MediaType.mobile
      renderSideBar()

      expect(screen.queryByText('explore.sidebar.noApps.title')).not.toBeInTheDocument()
      expect(screen.queryByText('explore.sidebar.webApps')).not.toBeInTheDocument()
    })
  })
})
