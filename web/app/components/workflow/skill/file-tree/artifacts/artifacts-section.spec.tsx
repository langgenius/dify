import type { SandboxFileDownloadTicket, SandboxFileTreeNode } from '@/types/sandbox-file'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ArtifactsSection from './artifacts-section'

type MockStoreState = {
  appId: string | undefined
  selectedArtifactPath: string | null
}

const mocks = vi.hoisted(() => ({
  storeState: {
    appId: 'app-1',
    selectedArtifactPath: null,
  } as MockStoreState,
  treeData: undefined as SandboxFileTreeNode[] | undefined,
  hasFiles: false,
  isLoading: false,
  isDownloading: false,
  selectArtifact: vi.fn(),
  fetchDownloadUrl: vi.fn<(path: string) => Promise<SandboxFileDownloadTicket>>(),
  downloadUrl: vi.fn(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: MockStoreState) => unknown) => selector(mocks.storeState),
  useWorkflowStore: () => ({
    getState: () => ({
      selectArtifact: mocks.selectArtifact,
    }),
  }),
}))

vi.mock('@/service/use-sandbox-file', () => ({
  useSandboxFilesTree: () => ({
    data: mocks.treeData,
    hasFiles: mocks.hasFiles,
    isLoading: mocks.isLoading,
  }),
  useDownloadSandboxFile: () => ({
    mutateAsync: mocks.fetchDownloadUrl,
    isPending: mocks.isDownloading,
  }),
}))

vi.mock('@/utils/download', () => ({
  downloadUrl: (...args: unknown[]) => mocks.downloadUrl(...args),
}))

const createNode = (overrides: Partial<SandboxFileTreeNode> = {}): SandboxFileTreeNode => ({
  id: 'node-1',
  name: 'report.txt',
  path: 'report.txt',
  node_type: 'file',
  size: 1,
  mtime: 1700000000,
  extension: 'txt',
  children: [],
  ...overrides,
})

describe('ArtifactsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.storeState.appId = 'app-1'
    mocks.storeState.selectedArtifactPath = null
    mocks.treeData = undefined
    mocks.hasFiles = false
    mocks.isLoading = false
    mocks.isDownloading = false
    mocks.fetchDownloadUrl.mockResolvedValue({
      download_url: 'https://example.com/download/report.txt',
      expires_in: 3600,
      export_id: 'abc123def4567890',
    })
  })

  // Covers collapsed header rendering and visual indicators.
  describe('Rendering', () => {
    it('should render collapsed header and apply custom className', () => {
      const { container } = render(<ArtifactsSection className="px-2" />)

      expect(screen.getByRole('button', { name: /workflow\.skillSidebar\.artifacts\.openArtifacts/i })).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByText('workflow.skillSidebar.artifacts.title')).toBeInTheDocument()
      expect(container.firstChild).toHaveClass('px-2')
    })

    it('should show blue dot when collapsed and files exist', () => {
      mocks.hasFiles = true
      mocks.treeData = [createNode()]

      const { container } = render(<ArtifactsSection />)

      expect(container.querySelector('.bg-state-accent-solid')).toBeInTheDocument()
    })

    it('should show spinner when file tree is loading', () => {
      mocks.isLoading = true

      const { container } = render(<ArtifactsSection />)

      expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    })
  })

  // Covers expanded branches for empty and loading states.
  describe('Expanded content', () => {
    it('should render empty state when expanded and there are no files', () => {
      render(<ArtifactsSection />)

      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.artifacts\.openArtifacts/i }))

      expect(screen.getByText('workflow.skillSidebar.artifacts.emptyState')).toBeInTheDocument()
    })

    it('should not render empty state content while loading even when expanded', () => {
      mocks.isLoading = true

      render(<ArtifactsSection />)
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.artifacts\.openArtifacts/i }))

      expect(screen.queryByText('workflow.skillSidebar.artifacts.emptyState')).not.toBeInTheDocument()
    })
  })

  // Covers real tree integration for selecting and downloading artifacts.
  describe('Artifacts tree interactions', () => {
    it('should render file rows and select artifact path when a file is clicked', () => {
      const selectedFile = createNode({ id: 'selected', name: 'a.txt', path: 'a.txt' })
      const otherFile = createNode({ id: 'other', name: 'b.txt', path: 'b.txt' })
      mocks.hasFiles = true
      mocks.treeData = [selectedFile, otherFile]
      mocks.storeState.selectedArtifactPath = 'a.txt'

      render(<ArtifactsSection />)

      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.artifacts\.openArtifacts/i }))

      expect(screen.getByRole('button', { name: 'a.txt' })).toHaveAttribute('aria-selected', 'true')
      fireEvent.click(screen.getByRole('button', { name: 'b.txt' }))

      expect(mocks.selectArtifact).toHaveBeenCalledTimes(1)
      expect(mocks.selectArtifact).toHaveBeenCalledWith('b.txt')
    })

    it('should request download URL and trigger browser download when file download succeeds', async () => {
      const file = createNode({ name: 'export.csv', path: 'export.csv', extension: 'csv' })
      mocks.hasFiles = true
      mocks.treeData = [file]
      mocks.fetchDownloadUrl.mockResolvedValue({
        download_url: 'https://example.com/download/export.csv',
        expires_in: 3600,
        export_id: 'fedcba9876543210',
      })

      render(<ArtifactsSection />)
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.artifacts\.openArtifacts/i }))
      fireEvent.click(screen.getByRole('button', { name: 'Download export.csv' }))

      await waitFor(() => {
        expect(mocks.fetchDownloadUrl).toHaveBeenCalledWith('export.csv')
      })
      await waitFor(() => {
        expect(mocks.downloadUrl).toHaveBeenCalledWith({
          url: 'https://example.com/download/export.csv',
          fileName: 'export.csv',
        })
      })
    })

    it('should log error and skip browser download when download request fails', async () => {
      const file = createNode({ name: 'broken.bin', path: 'broken.bin', extension: 'bin' })
      const error = new Error('request failed')
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      mocks.hasFiles = true
      mocks.treeData = [file]
      mocks.fetchDownloadUrl.mockRejectedValue(error)

      render(<ArtifactsSection />)
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.artifacts\.openArtifacts/i }))
      fireEvent.click(screen.getByRole('button', { name: 'Download broken.bin' }))

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith('Download failed:', error)
      })
      expect(mocks.downloadUrl).not.toHaveBeenCalled()

      consoleErrorSpy.mockRestore()
    })

    it('should disable download buttons when a download request is pending', () => {
      const file = createNode({ name: 'asset.png', path: 'asset.png', extension: 'png' })
      mocks.hasFiles = true
      mocks.treeData = [file]
      mocks.isDownloading = true

      render(<ArtifactsSection />)
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.artifacts\.openArtifacts/i }))

      expect(screen.getByRole('button', { name: 'Download asset.png' })).toBeDisabled()
    })
  })
})
