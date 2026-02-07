import type { SandboxFileTreeNode } from '@/types/sandbox-file'
import { fireEvent, render, screen } from '@testing-library/react'
import ArtifactsTree from './artifacts-tree'

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

describe('ArtifactsTree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Covers guard branches when no tree data is available.
  describe('Rendering', () => {
    it('should render nothing when data is undefined', () => {
      const { container } = render(<ArtifactsTree data={undefined} onDownload={vi.fn()} />)

      expect(container.firstChild).toBeNull()
    })

    it('should render nothing when data is empty', () => {
      const { container } = render(<ArtifactsTree data={[]} onDownload={vi.fn()} />)

      expect(container.firstChild).toBeNull()
    })

    it('should reveal and hide children when folder row is toggled', () => {
      const child = createNode({
        id: 'node-child',
        name: 'nested.txt',
        path: 'docs/nested.txt',
      })
      const folder = createNode({
        id: 'node-folder',
        name: 'docs',
        path: 'docs',
        node_type: 'folder',
        extension: null,
        children: [child],
      })

      render(<ArtifactsTree data={[folder]} onDownload={vi.fn()} />)

      const folderButton = screen.getByRole('button', { name: 'docs folder' })
      expect(folderButton).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('button', { name: 'nested.txt' })).not.toBeInTheDocument()

      fireEvent.click(folderButton)

      expect(folderButton).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('button', { name: 'nested.txt' })).toBeInTheDocument()

      fireEvent.click(folderButton)

      expect(folderButton).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('button', { name: 'nested.txt' })).not.toBeInTheDocument()
    })
  })

  // Covers keyboard-driven expansion/selection behavior.
  describe('Keyboard interactions', () => {
    it('should toggle a folder when Enter and Space keys are pressed', () => {
      const folder = createNode({
        id: 'node-folder',
        name: 'assets',
        path: 'assets',
        node_type: 'folder',
        extension: null,
      })

      render(<ArtifactsTree data={[folder]} onDownload={vi.fn()} />)

      const folderButton = screen.getByRole('button', { name: 'assets folder' })

      fireEvent.keyDown(folderButton, { key: 'Enter' })
      expect(folderButton).toHaveAttribute('aria-expanded', 'true')

      fireEvent.keyDown(folderButton, { key: ' ' })
      expect(folderButton).toHaveAttribute('aria-expanded', 'false')
    })

    it('should call onSelect when Enter is pressed on a file row', () => {
      const file = createNode({ name: 'guide.md', path: 'guide.md', extension: 'md' })
      const onSelect = vi.fn()

      render(
        <ArtifactsTree
          data={[file]}
          onDownload={vi.fn()}
          onSelect={onSelect}
        />,
      )

      fireEvent.keyDown(screen.getByRole('button', { name: 'guide.md' }), { key: 'Enter' })

      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onSelect).toHaveBeenCalledWith(file)
    })
  })

  // Covers selection state and click behavior for file rows.
  describe('Selection', () => {
    it('should call onSelect when a file row is clicked', () => {
      const file = createNode({ name: 'main.py', path: 'src/main.py', extension: 'py' })
      const onSelect = vi.fn()

      render(
        <ArtifactsTree
          data={[file]}
          onDownload={vi.fn()}
          onSelect={onSelect}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'main.py' }))

      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onSelect).toHaveBeenCalledWith(file)
    })

    it('should mark only the matching file path as selected', () => {
      const selectedFile = createNode({ id: 'selected', name: 'a.txt', path: 'a.txt' })
      const otherFile = createNode({ id: 'other', name: 'b.txt', path: 'b.txt' })

      render(
        <ArtifactsTree
          data={[selectedFile, otherFile]}
          onDownload={vi.fn()}
          selectedPath="a.txt"
        />,
      )

      expect(screen.getByRole('button', { name: 'a.txt' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('button', { name: 'b.txt' })).toHaveAttribute('aria-selected', 'false')
    })
  })

  // Covers download events including stopPropagation and disabled state.
  describe('Download', () => {
    it('should call onDownload without triggering onSelect when download button is clicked', () => {
      const file = createNode({ name: 'archive.zip', path: 'archive.zip', extension: 'zip' })
      const onDownload = vi.fn()
      const onSelect = vi.fn()

      render(
        <ArtifactsTree
          data={[file]}
          onDownload={onDownload}
          onSelect={onSelect}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Download archive.zip' }))

      expect(onDownload).toHaveBeenCalledTimes(1)
      expect(onDownload).toHaveBeenCalledWith(file)
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('should disable download buttons when isDownloading is true', () => {
      const file = createNode({ name: 'asset.png', path: 'asset.png', extension: 'png' })
      const onDownload = vi.fn()

      render(
        <ArtifactsTree
          data={[file]}
          onDownload={onDownload}
          isDownloading
        />,
      )

      const downloadButton = screen.getByRole('button', { name: 'Download asset.png' })
      expect(downloadButton).toBeDisabled()

      fireEvent.click(downloadButton)

      expect(onDownload).not.toHaveBeenCalled()
    })
  })
})
