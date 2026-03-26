import type { SandboxFileNode } from '@/types/sandbox-file'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useArtifactsInspectView } from './hooks/use-artifacts-inspect-state'

type MockStoreState = {
  appId: string | undefined
  workflowRunningData?: {
    result?: {
      status?: string
    }
  }
  isResponding: boolean
}

const mocks = vi.hoisted(() => ({
  storeState: {
    appId: 'app-1',
    workflowRunningData: undefined,
    isResponding: false,
  } as MockStoreState,
  flatData: [] as SandboxFileNode[],
  isLoading: false,
  fetchDownloadUrl: vi.fn(),
  mockUseQuery: vi.fn(),
  mockDownloadUrlOptions: vi.fn().mockReturnValue({
    queryKey: ['sandboxFile', 'downloadFile'],
    queryFn: vi.fn(),
  }),
  mockTreeOptions: vi.fn().mockReturnValue({
    queryKey: ['sandboxFile', 'listFiles'],
    queryFn: vi.fn(),
  }),
}))

vi.mock('../store', () => ({
  useStore: (selector: (state: MockStoreState) => unknown) => selector(mocks.storeState),
}))

vi.mock('@tanstack/react-query', async importOriginal => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: (options: { queryKey?: unknown }) => mocks.mockUseQuery(options),
}))

vi.mock('@/service/use-sandbox-file', async importOriginal => ({
  ...(await importOriginal<typeof import('@/service/use-sandbox-file')>()),
  sandboxFileDownloadUrlOptions: (...args: unknown[]) => mocks.mockDownloadUrlOptions(...args),
  sandboxFilesTreeOptions: (...args: unknown[]) => mocks.mockTreeOptions(...args),
  useDownloadSandboxFile: () => ({
    mutateAsync: mocks.fetchDownloadUrl,
    isPending: false,
  }),
}))

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
}))

const createFlatFileNode = (overrides: Partial<SandboxFileNode> = {}): SandboxFileNode => ({
  path: 'a.txt',
  is_dir: false,
  size: 128,
  mtime: 1700000000,
  extension: 'txt',
  ...overrides,
})

describe('useArtifactsInspectState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.storeState.appId = 'app-1'
    mocks.storeState.workflowRunningData = undefined
    mocks.storeState.isResponding = false

    mocks.flatData = [createFlatFileNode()]
    mocks.isLoading = false
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

  it('should stop using stale file path for download url query after files are cleared', async () => {
    const { result, rerender } = renderHook(() => useArtifactsInspectView())

    act(() => {
      result.current.handleFileSelect({
        name: 'a.txt',
        path: 'a.txt',
        node_type: 'file',
        size: 128,
        extension: 'txt',
      } as never)
    })

    await waitFor(() => {
      expect(mocks.mockDownloadUrlOptions).toHaveBeenCalledWith('app-1', 'a.txt')
    })

    mocks.flatData = []
    rerender()

    await waitFor(() => {
      const lastCall = mocks.mockDownloadUrlOptions.mock.calls.at(-1)
      expect(lastCall).toEqual(['app-1', undefined])
    })
  })
})
