import type { AppAssetTreeView } from '@/types/app-asset'
import { fireEvent, render, screen } from '@testing-library/react'
import SearchResultList from './search-result-list'

type MockWorkflowState = {
  activeTabId: string | null
}

const mocks = vi.hoisted(() => ({
  storeState: {
    activeTabId: null,
  } as MockWorkflowState,
  clearArtifactSelection: vi.fn(),
  openTab: vi.fn(),
  revealFile: vi.fn(),
  setFileTreeSearchTerm: vi.fn(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: MockWorkflowState) => unknown) => selector(mocks.storeState),
  useWorkflowStore: () => ({
    getState: () => ({
      clearArtifactSelection: mocks.clearArtifactSelection,
      openTab: mocks.openTab,
      revealFile: mocks.revealFile,
      setFileTreeSearchTerm: mocks.setFileTreeSearchTerm,
    }),
  }),
}))

const createNode = (overrides: Partial<AppAssetTreeView> = {}): AppAssetTreeView => ({
  id: 'node-1',
  node_type: 'file',
  name: 'readme.md',
  path: '/readme.md',
  extension: 'md',
  size: 10,
  children: [],
  ...overrides,
})

const setActiveTabId = (activeTabId: string | null) => {
  mocks.storeState.activeTabId = activeTabId
}

describe('SearchResultList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    setActiveTabId(null)
  })

  // Search results should render only matching items with path hints when available.
  describe('Rendering', () => {
    it('should render matching nodes and parent path when search term matches', () => {
      const treeChildren = [
        createNode({ id: 'file-1', name: 'readme.md', path: '/src/readme.md' }),
        createNode({ id: 'file-2', name: 'guide.txt', path: '/guide.txt', extension: 'txt' }),
      ]

      render(<SearchResultList searchTerm="read" treeChildren={treeChildren} />)

      expect(screen.getByText('readme.md')).toBeInTheDocument()
      expect(screen.queryByText('guide.txt')).not.toBeInTheDocument()
      expect(screen.getByText('src')).toBeInTheDocument()
    })

    it('should render active row style when node id matches active tab id', () => {
      setActiveTabId('file-1')
      const treeChildren = [createNode({ id: 'file-1', name: 'readme.md' })]

      render(<SearchResultList searchTerm="read" treeChildren={treeChildren} />)

      const row = screen.getByText('readme.md').closest('[role="button"]')
      expect(row).toHaveClass('bg-state-base-active')
    })

    it('should render no rows when search term is empty', () => {
      const treeChildren = [createNode({ id: 'file-1', name: 'readme.md' })]

      render(<SearchResultList searchTerm="" treeChildren={treeChildren} />)

      expect(screen.queryByText('readme.md')).not.toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  // File and folder actions should dispatch the correct store operations.
  describe('Interactions', () => {
    it('should open file preview when file row is single clicked', () => {
      vi.useFakeTimers()
      const treeChildren = [createNode({ id: 'file-1', name: 'readme.md' })]

      render(<SearchResultList searchTerm="read" treeChildren={treeChildren} />)

      const row = screen.getByText('readme.md').closest('[role="button"]')
      if (!row)
        throw new Error('Expected row element for readme.md')

      fireEvent.click(row)
      expect(mocks.openTab).not.toHaveBeenCalled()

      vi.runAllTimers()

      expect(mocks.clearArtifactSelection).toHaveBeenCalledTimes(1)
      expect(mocks.openTab).toHaveBeenCalledTimes(1)
      expect(mocks.openTab).toHaveBeenCalledWith('file-1', { pinned: false })
    })

    it('should open file pinned when file row is double clicked', () => {
      vi.useFakeTimers()
      const treeChildren = [createNode({ id: 'file-1', name: 'readme.md' })]

      render(<SearchResultList searchTerm="read" treeChildren={treeChildren} />)

      const row = screen.getByText('readme.md').closest('[role="button"]')
      if (!row)
        throw new Error('Expected row element for readme.md')

      fireEvent.doubleClick(row)
      vi.runAllTimers()

      expect(mocks.clearArtifactSelection).toHaveBeenCalledTimes(1)
      expect(mocks.openTab).toHaveBeenCalledTimes(1)
      expect(mocks.openTab).toHaveBeenCalledWith('file-1', { pinned: true })
    })

    it('should reveal folder and clear search when folder row is clicked', () => {
      const treeChildren = [
        createNode({
          id: 'folder-1',
          node_type: 'folder',
          name: 'src',
          path: '/src',
          extension: '',
          children: [createNode({ id: 'file-1', name: 'readme.md', path: '/src/readme.md' })],
        }),
      ]

      render(<SearchResultList searchTerm="src" treeChildren={treeChildren} />)

      const row = screen.getByText('src').closest('[role="button"]')
      if (!row)
        throw new Error('Expected row element for src')

      fireEvent.click(row)

      expect(mocks.revealFile).toHaveBeenCalledTimes(1)
      expect(mocks.revealFile).toHaveBeenCalledWith(['folder-1'])
      expect(mocks.setFileTreeSearchTerm).toHaveBeenCalledTimes(1)
      expect(mocks.setFileTreeSearchTerm).toHaveBeenCalledWith('')
      expect(mocks.openTab).not.toHaveBeenCalled()
    })

    it('should open file pinned when Enter key is pressed on a file row', () => {
      const treeChildren = [createNode({ id: 'file-1', name: 'readme.md' })]

      render(<SearchResultList searchTerm="read" treeChildren={treeChildren} />)

      const row = screen.getByText('readme.md').closest('[role="button"]')
      if (!row)
        throw new Error('Expected row element for readme.md')

      fireEvent.keyDown(row, { key: 'Enter' })

      expect(mocks.clearArtifactSelection).toHaveBeenCalledTimes(1)
      expect(mocks.openTab).toHaveBeenCalledTimes(1)
      expect(mocks.openTab).toHaveBeenCalledWith('file-1', { pinned: true })
    })
  })
})
