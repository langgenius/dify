import type {
  SkillDetailResponse,
  SkillFileResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { FileTreeNode } from '../shared'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FileTreeItem, FileTreeNameInput } from '../file-tree-items'

const skillFile: SkillFileResponse = {
  id: 'file-1',
  path: 'scripts/example.ts',
  kind: 'file',
  storage: 'text',
  mime_type: 'text/typescript',
  content: 'export {}\n',
  tool_file_id: null,
  size: 10,
  hash: 'hash-1',
}

const skillDetail = {
  id: 'skill-1',
} as SkillDetailResponse

function createFileNode(overrides: Partial<FileTreeNode> = {}): FileTreeNode {
  return {
    file: skillFile,
    id: 'node-1',
    name: 'example.ts',
    path: 'scripts/example.ts',
    type: 'file',
    ...overrides,
  }
}

function createFolderNode(overrides: Partial<FileTreeNode> = {}): FileTreeNode {
  return {
    children: [createFileNode()],
    id: 'folder-1',
    name: 'scripts',
    path: 'scripts',
    type: 'directory',
    ...overrides,
  }
}

function renderFileTreeItem(
  overrides: Partial<Parameters<typeof FileTreeItem>[0]> = {},
  node: FileTreeNode = createFileNode(),
) {
  const props: Parameters<typeof FileTreeItem>[0] = {
    collapsedFolderPaths: [],
    detail: skillDetail,
    draggingPaths: [],
    dropTarget: undefined,
    inlineAction: undefined,
    inlineActionLoading: false,
    node,
    onCancelInlineAction: vi.fn(),
    onCopy: vi.fn(),
    onCreate: vi.fn(),
    onCut: vi.fn(),
    onDelete: vi.fn(),
    onDropFiles: vi.fn(),
    onExpandFolder: vi.fn(),
    onItemSelect: vi.fn(),
    onMove: vi.fn(),
    onRename: vi.fn(),
    onSelect: vi.fn(),
    onSetDraggingPaths: vi.fn(),
    onSetDropTarget: vi.fn(),
    onSubmitInlineAction: vi.fn(),
    onToggleFolder: vi.fn(),
    onUploadFiles: vi.fn(),
    readonly: false,
    selectedPath: undefined,
    selectedPaths: [],
    ...overrides,
  }

  return {
    ...render(<FileTreeItem {...props} />),
    props,
  }
}

describe('FileTreeItem', () => {
  it('submits and cancels inline file names from the keyboard', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(
      <FileTreeNameInput
        loading={false}
        nodeType="file"
        onCancel={onCancel}
        onSubmit={onSubmit}
        placeholder="File name"
      />,
    )

    const input = screen.getByPlaceholderText('File name')
    await user.type(input, ' guide.md {Enter}')
    await user.keyboard('{Enter}')

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledWith('guide.md')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('selects only the basename when renaming an existing file', async () => {
    render(
      <FileTreeNameInput
        file={skillFile}
        initialValue="example.ts"
        loading={false}
        nodeType="file"
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        selectBaseName
      />,
    )

    const input = screen.getByDisplayValue('example.ts') as HTMLInputElement
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('example'.length)
  })

  it('cancels an empty inline folder name on blur', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(
      <FileTreeNameInput
        loading={false}
        nodeType="directory"
        onCancel={onCancel}
        onSubmit={onSubmit}
        placeholder="Folder name"
      />,
    )

    await user.click(screen.getByPlaceholderText('Folder name'))
    await user.tab()

    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('selects and pins file nodes from the file button', async () => {
    const user = userEvent.setup()
    const { props } = renderFileTreeItem()

    const button = screen.getByRole('button', { name: 'example.ts' })
    await user.click(button)
    await user.dblClick(button)

    expect(props.onItemSelect).toHaveBeenCalledWith(expect.anything(), expect.anything())
    expect(props.onSelect).toHaveBeenCalledWith('scripts/example.ts', 'preview')
    expect(props.onSelect).toHaveBeenCalledWith('scripts/example.ts', 'pinned')
  })

  it('dispatches file action menu commands', async () => {
    const user = userEvent.setup()
    const { props } = renderFileTreeItem({}, createFileNode({ name: 'example.ts' }))

    const treeItem = screen.getByText('example.ts').closest('[data-skill-file-tree-item]')
    expect(treeItem).toBeInstanceOf(HTMLElement)

    await user.click(
      within(treeItem as HTMLElement).getByRole('button', { name: 'common.operation.more' }),
    )
    await user.click(await screen.findByText('skill.skillManagement.detail.copyFile'))
    await user.click(
      within(treeItem as HTMLElement).getByRole('button', { name: 'common.operation.more' }),
    )
    await user.click(await screen.findByText('skill.skillManagement.detail.cutFile'))
    await user.click(
      within(treeItem as HTMLElement).getByRole('button', { name: 'common.operation.more' }),
    )
    await user.click(await screen.findByText(/common.operation.rename/))
    await user.click(
      within(treeItem as HTMLElement).getByRole('button', { name: 'common.operation.more' }),
    )
    await user.click(await screen.findByText('common.operation.delete'))

    expect(props.onCopy).toHaveBeenCalledWith('scripts/example.ts')
    expect(props.onCut).toHaveBeenCalledWith('scripts/example.ts')
    expect(props.onRename).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'scripts/example.ts' }),
    )
    expect(props.onDelete).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'scripts/example.ts' }),
    )
  })

  it('dispatches folder action menu commands and toggles folders', async () => {
    const user = userEvent.setup()
    const folderNode = createFolderNode()
    const { props } = renderFileTreeItem({}, folderNode)

    const folder = screen.getByText('scripts').closest('[data-skill-file-tree-item]')
    expect(folder).toBeInstanceOf(HTMLElement)
    await user.dblClick(folder as HTMLElement)
    expect(props.onToggleFolder).toHaveBeenCalledWith('scripts')

    await user.click(
      within(folder as HTMLElement).getByRole('button', { name: 'common.operation.more' }),
    )
    await user.click(await screen.findByText('skill.skillManagement.detail.createFileMenu'))
    await user.click(
      within(folder as HTMLElement).getByRole('button', { name: 'common.operation.more' }),
    )
    await user.click(await screen.findByText('skill.skillManagement.detail.createFolderMenu'))
    await user.click(
      within(folder as HTMLElement).getByRole('button', { name: 'common.operation.more' }),
    )
    await user.click(await screen.findByText('skill.skillManagement.detail.uploadFilesMenu'))

    expect(props.onCreate).toHaveBeenCalledWith('file', 'scripts')
    expect(props.onCreate).toHaveBeenCalledWith('directory', 'scripts')
  })

  it('renders a rename input for the active inline action', async () => {
    const user = userEvent.setup()
    const onSubmitInlineAction = vi.fn()
    renderFileTreeItem({
      inlineAction: {
        kind: 'rename',
        nodeType: 'file',
        path: 'scripts/example.ts',
      },
      onSubmitInlineAction,
    })

    const input = screen.getByDisplayValue('example.ts')
    await user.clear(input)
    await user.type(input, 'renamed.ts{Enter}')

    expect(onSubmitInlineAction).toHaveBeenCalledWith('renamed.ts')
  })

  it('hides file action controls in read-only mode', () => {
    renderFileTreeItem({ readonly: true })

    expect(screen.getByRole('button', { name: 'example.ts' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.more' })).not.toBeInTheDocument()
  })
})
