import type { SandboxFileNode, SandboxFileTreeNode } from '@/types/sandbox-file'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ArtifactsTab from './artifacts-tab'
import { InspectTab } from './types'

type MockStoreState = {
  appId: string | undefined
  workflowRunningData?: {
    result?: {
      status?: string
    }
  }
  isResponding: boolean
  bottomPanelWidth: number
}

const mocks = vi.hoisted(() => ({
  storeState: {
    appId: 'app-1',
    workflowRunningData: undefined,
    isResponding: false,
    bottomPanelWidth: 640,
  } as MockStoreState,
  treeData: undefined as SandboxFileTreeNode[] | undefined,
  flatData: [] as SandboxFileNode[],
  hasFiles: false,
  isLoading: false,
  fetchDownloadUrl: vi.fn(),
  useSandboxFileDownloadUrl: vi.fn(),
}))

vi.mock('../store', () => ({
  useStore: (selector: (state: MockStoreState) => unknown) => selector(mocks.storeState),
}))

vi.mock('@/service/use-sandbox-file', () => ({
  useSandboxFilesTree: () => ({
    data: mocks.treeData,
    flatData: mocks.flatData,
    hasFiles: mocks.hasFiles,
    isLoading: mocks.isLoading,
  }),
  useDownloadSandboxFile: () => ({
    mutateAsync: mocks.fetchDownloadUrl,
    isPending: false,
  }),
  useSandboxFileDownloadUrl: (...args: unknown[]) => mocks.useSandboxFileDownloadUrl(...args),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => path,
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: (selector: (state: { features: { sandbox: { enabled: boolean } } }) => unknown) => selector({
    features: {
      sandbox: {
        enabled: true,
      },
    },
  }),
}))

vi.mock('@/utils/download', () => ({
  downloadUrl: vi.fn(),
}))

const createTreeFileNode = (overrides: Partial<SandboxFileTreeNode> = {}): SandboxFileTreeNode => ({
  id: 'a.txt',
  name: 'a.txt',
  path: 'a.txt',
  node_type: 'file',
  size: 128,
  mtime: 1700000000,
  extension: 'txt',
  children: [],
  ...overrides,
})

const createFlatFileNode = (overrides: Partial<SandboxFileNode> = {}): SandboxFileNode => ({
  path: 'a.txt',
  is_dir: false,
  size: 128,
  mtime: 1700000000,
  extension: 'txt',
  ...overrides,
})

describe('ArtifactsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.storeState.appId = 'app-1'
    mocks.storeState.workflowRunningData = undefined
    mocks.storeState.isResponding = false
    mocks.storeState.bottomPanelWidth = 640

    mocks.treeData = [createTreeFileNode()]
    mocks.flatData = [createFlatFileNode()]
    mocks.hasFiles = true
    mocks.isLoading = false
    mocks.useSandboxFileDownloadUrl.mockReturnValue({
      data: undefined,
      isLoading: false,
    })
  })

  it('should stop using stale file path for download url query after files are cleared', async () => {
    const headerProps = {
      activeTab: InspectTab.Artifacts,
      onTabChange: vi.fn(),
      onClose: vi.fn(),
    }

    const { rerender } = render(<ArtifactsTab {...headerProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'a.txt' }))

    await waitFor(() => {
      expect(mocks.useSandboxFileDownloadUrl).toHaveBeenCalledWith(
        'app-1',
        'a.txt',
        { retry: false },
      )
    })

    mocks.treeData = undefined
    mocks.flatData = []
    mocks.hasFiles = false

    rerender(<ArtifactsTab {...headerProps} />)

    await waitFor(() => {
      const lastCall = mocks.useSandboxFileDownloadUrl.mock.calls.at(-1)
      expect(lastCall).toEqual([
        'app-1',
        undefined,
        { retry: false },
      ])
    })
  })
})
