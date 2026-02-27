import type { SandboxFileDownloadTicket, SandboxFileNode } from '@/types/sandbox-file'
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
  flatData: [] as SandboxFileNode[],
  isLoading: false,
  isDownloading: false,
  selectArtifact: vi.fn(),
  fetchDownloadUrl: vi.fn<(path: string) => Promise<SandboxFileDownloadTicket>>(),
  downloadUrl: vi.fn(),
  mockUseQuery: vi.fn(),
  mockTreeOptions: vi.fn().mockReturnValue({
    queryKey: ['sandboxFile', 'listFiles'],
    queryFn: vi.fn(),
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: MockStoreState) => unknown) => selector(mocks.storeState),
  useWorkflowStore: () => ({
    getState: () => ({
      selectArtifact: mocks.selectArtifact,
    }),
  }),
}))

vi.mock('@tanstack/react-query', async importOriginal => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: (options: unknown) => mocks.mockUseQuery(options),
}))

vi.mock('@/service/use-sandbox-file', async importOriginal => ({
  ...(await importOriginal<typeof import('@/service/use-sandbox-file')>()),
  sandboxFilesTreeOptions: (...args: unknown[]) => mocks.mockTreeOptions(...args),
  useDownloadSandboxFile: () => ({
    mutateAsync: mocks.fetchDownloadUrl,
    isPending: mocks.isDownloading,
  }),
}))

vi.mock('@/utils/download', () => ({
  downloadUrl: (...args: unknown[]) => mocks.downloadUrl(...args),
}))

const createFlatFileNode = (overrides: Partial<SandboxFileNode> = {}): SandboxFileNode => ({
  path: 'report.txt',
  is_dir: false,
  size: 1,
  mtime: 1700000000,
  extension: 'txt',
  ...overrides,
})

describe('ArtifactsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.storeState.appId = 'app-1'
    mocks.storeState.selectedArtifactPath = null
    mocks.flatData = []
    mocks.isLoading = false
    mocks.isDownloading = false
    mocks.fetchDownloadUrl.mockResolvedValue({
      download_url: 'https://example.com/download/report.txt',
      expires_in: 3600,
      export_id: 'abc123def4567890',
    })
    mocks.mockUseQuery.mockImplementation((options: { queryKey?: unknown }) => {
      const treeKey = mocks.mockTreeOptions.mock.results.at(-1)?.value?.queryKey
      if (treeKey && options.queryKey === treeKey) {
        return {
          data: mocks.flatData,
          isLoading: mocks.isLoading,
        }
      }
      return {
        data: undefined,
        isLoading: false,
      }
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
      mocks.flatData = [createFlatFileNode()]

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
      const selectedFile = createFlatFileNode({ path: 'a.txt', extension: 'txt' })
      const otherFile = createFlatFileNode({ path: 'b.txt', extension: 'txt' })
      mocks.flatData = [selectedFile, otherFile]
      mocks.storeState.selectedArtifactPath = 'a.txt'

      render(<ArtifactsSection />)

      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.artifacts\.openArtifacts/i }))

      expect(screen.getByRole('button', { name: 'a.txt' })).toHaveAttribute('aria-selected', 'true')
      fireEvent.click(screen.getByRole('button', { name: 'b.txt' }))

      expect(mocks.selectArtifact).toHaveBeenCalledTimes(1)
      expect(mocks.selectArtifact).toHaveBeenCalledWith('b.txt')
    })

    it('should request download URL and trigger browser download when file download succeeds', async () => {
      const file = createFlatFileNode({ path: 'export.csv', extension: 'csv' })
      mocks.flatData = [file]
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
      const file = createFlatFileNode({ path: 'broken.bin', extension: 'bin' })
      const error = new Error('request failed')
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      mocks.flatData = [file]
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
      const file = createFlatFileNode({ path: 'asset.png', extension: 'png' })
      mocks.flatData = [file]
      mocks.isDownloading = true

      render(<ArtifactsSection />)
      fireEvent.click(screen.getByRole('button', { name: /workflow\.skillSidebar\.artifacts\.openArtifacts/i }))

      expect(screen.getByRole('button', { name: 'Download asset.png' })).toBeDisabled()
    })
  })
})
