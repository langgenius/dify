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
  mockUseQuery: vi.fn(),
  mockDownloadUrlOptions: vi.fn().mockReturnValue({
    queryKey: ['sandboxFile', 'downloadFile'],
    queryFn: vi.fn(),
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: WorkflowStoreState) => unknown) => selector(mocks.workflowState),
}))

vi.mock('@tanstack/react-query', async importOriginal => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: (options: unknown) => mocks.mockUseQuery(options),
}))

vi.mock('@/service/use-sandbox-file', () => ({
  sandboxFileDownloadUrlOptions: (...args: unknown[]) => mocks.mockDownloadUrlOptions(...args),
}))

describe('ArtifactContentPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workflowState.activeTabId = 'artifact:/assets/report.bin'
    mocks.workflowState.appId = 'app-1'
    mocks.mockUseQuery.mockReturnValue({
      data: { download_url: 'https://example.com/report.bin' },
      isLoading: false,
    })
  })

  describe('Rendering', () => {
    it('should show loading indicator when download ticket is loading', () => {
      mocks.mockUseQuery.mockReturnValue({
        data: undefined,
        isLoading: true,
      })

      render(<ArtifactContentPanel />)

      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should show load error message when download url is unavailable', () => {
      mocks.mockUseQuery.mockReturnValue({
        data: { download_url: '' },
        isLoading: false,
      })

      render(<ArtifactContentPanel />)

      expect(screen.getByText('workflow.skillSidebar.loadError')).toBeInTheDocument()
    })

    it('should render preview panel when ticket contains download url', () => {
      render(<ArtifactContentPanel />)

      expect(screen.getByText('report.bin')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /common\.operation\.download/i })).toBeInTheDocument()
    })
  })

  describe('Data flow', () => {
    it('should request ticket using app id and artifact path when tab is selected', () => {
      render(<ArtifactContentPanel />)

      expect(mocks.mockDownloadUrlOptions).toHaveBeenCalledWith('app-1', '/assets/report.bin')
    })
  })

  describe('Edge Cases', () => {
    it('should pass undefined path to options factory when active tab id is null', () => {
      mocks.workflowState.activeTabId = null

      render(<ArtifactContentPanel />)

      expect(mocks.mockDownloadUrlOptions).toHaveBeenCalledWith('app-1', undefined)
    })
  })
})
