import type { App } from '@/types/app'
import { render, screen, waitFor } from '@testing-library/react'
import { useStore } from '@/app/components/app/store'
import { usePathname, useRouter } from '@/next/navigation'
import { fetchAppDetailDirect } from '@/service/apps'
import { AppModeEnum } from '@/types/app'
import AppDetailLayout from '../layout-main'

const mockReplace = vi.fn()
let mockPathname = '/app/app-1/workflow'
let mockIsCurrentWorkspaceEditor = true

vi.mock('@/next/navigation', () => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(),
}))

vi.mock('@/service/apps', () => ({
  fetchAppDetailDirect: vi.fn(),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    currentWorkspace: { id: 'workspace-1' },
    isCurrentWorkspaceEditor: mockIsCurrentWorkspaceEditor,
    isLoadingCurrentWorkspace: false,
  }),
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

const mockUsePathname = vi.mocked(usePathname)
const mockUseRouter = vi.mocked(useRouter)
const mockFetchAppDetailDirect = vi.mocked(fetchAppDetailDirect)

const createAppDetail = (overrides: Partial<App> = {}) => ({
  id: 'app-1',
  name: 'Demo App',
  mode: AppModeEnum.WORKFLOW,
  ...overrides,
}) as App

const waitForAppContent = async () => {
  await waitFor(() => {
    expect(screen.getByText('App page content')).toBeInTheDocument()
  })
}

describe('AppDetailLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname = '/app/app-1/workflow'
    mockIsCurrentWorkspaceEditor = true
    mockUsePathname.mockImplementation(() => mockPathname)
    mockUseRouter.mockReturnValue({
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      push: vi.fn(),
      replace: mockReplace,
      prefetch: vi.fn(),
    })
    mockFetchAppDetailDirect.mockResolvedValue(createAppDetail())
    useStore.getState().setAppDetail()
  })

  it('should keep app detail data when navigating between pages in the same app', async () => {
    const { rerender, unmount } = render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )
    await waitForAppContent()
    expect(mockFetchAppDetailDirect).toHaveBeenCalledTimes(1)

    mockPathname = '/app/app-1/logs'
    rerender(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitForAppContent()
    expect(mockFetchAppDetailDirect).toHaveBeenCalledTimes(1)
    expect(useStore.getState().appDetail?.id).toBe('app-1')

    unmount()
    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitForAppContent()
    expect(mockFetchAppDetailDirect).toHaveBeenCalledTimes(1)
    expect(useStore.getState().appDetail?.id).toBe('app-1')
  })

  it('should redirect restricted app pages before exposing app detail content', async () => {
    mockIsCurrentWorkspaceEditor = false
    mockPathname = '/app/app-1/logs'

    render(
      <AppDetailLayout appId="app-1">
        <div>App page content</div>
      </AppDetailLayout>,
    )

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/app/app-1/overview')
    })
    expect(screen.queryByText('App page content')).not.toBeInTheDocument()
    expect(useStore.getState().appDetail).toBeUndefined()
  })
})
