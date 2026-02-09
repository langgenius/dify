import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import ArtifactContentPanel from './artifact-content-panel'

type WorkflowStoreState = {
  activeTabId: string | null
  appId: string
}

const mocks = vi.hoisted(() => ({
  workflowState: {
    activeTabId: 'artifact:/assets/report.bin',
    appId: 'app-1',
  } as WorkflowStoreState,
  useSandboxFileDownloadUrl: vi.fn(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: WorkflowStoreState) => unknown) => selector(mocks.workflowState),
}))

vi.mock('@/service/use-sandbox-file', () => ({
  useSandboxFileDownloadUrl: (...args: unknown[]) => mocks.useSandboxFileDownloadUrl(...args),
}))

const renderPanel = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ArtifactContentPanel />
    </QueryClientProvider>,
  )
}

describe('ArtifactContentPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workflowState.activeTabId = 'artifact:/assets/report.bin'
    mocks.workflowState.appId = 'app-1'
    mocks.useSandboxFileDownloadUrl.mockReturnValue({
      data: { download_url: 'https://example.com/report.bin' },
      isLoading: false,
    })
  })

  describe('Rendering', () => {
    it('should show loading indicator when download ticket is loading', () => {
      // Arrange
      mocks.useSandboxFileDownloadUrl.mockReturnValue({
        data: undefined,
        isLoading: true,
      })

      // Act
      renderPanel()

      // Assert
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should show load error message when download url is unavailable', () => {
      // Arrange
      mocks.useSandboxFileDownloadUrl.mockReturnValue({
        data: { download_url: '' },
        isLoading: false,
      })

      // Act
      renderPanel()

      // Assert
      expect(screen.getByText('workflow.skillSidebar.loadError')).toBeInTheDocument()
    })

    it('should render preview panel when ticket contains download url', () => {
      // Act
      renderPanel()

      // Assert
      expect(screen.getByText('report.bin')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.download/i })).toBeInTheDocument()
    })
  })

  describe('Data flow', () => {
    it('should request ticket using app id and artifact path when tab is selected', () => {
      // Act
      renderPanel()

      // Assert
      expect(mocks.useSandboxFileDownloadUrl).toHaveBeenCalledTimes(1)
      expect(mocks.useSandboxFileDownloadUrl).toHaveBeenCalledWith('app-1', '/assets/report.bin')
    })
  })

  describe('Edge Cases', () => {
    it('should request ticket with undefined path when active tab id is null', () => {
      // Arrange
      mocks.workflowState.activeTabId = null

      // Act
      renderPanel()

      // Assert
      expect(mocks.useSandboxFileDownloadUrl).toHaveBeenCalledWith('app-1', undefined)
    })
  })
})
