import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  createSkillDetail,
  getFileTreeButton,
  getFileTreeItem,
  getMocks,
  openFileTreeActions,
  openRootCreateMenu,
  renderSkillDetailPage,
  resetDetailPageFixture,
} from './detail-page.fixture'

const mocks = getMocks()

describe('SkillDetailPage file mutations', () => {
  beforeEach(resetDetailPageFixture)

  it('creates a folder from the root file menu', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })
    await openRootCreateMenu(user)
    await user.click(await screen.findByText('skill.skillManagement.detail.createFolderMenu'))
    const folderNameInput = await screen.findByPlaceholderText(
      'skill.skillManagement.detail.createFolder',
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(folderNameInput).toHaveFocus()
    expect(folderNameInput).toHaveValue('')
    await user.type(folderNameInput, 'references{Enter}')

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            expected_updated_at: 1784638487,
            operation: 'mkdir',
            path: 'references',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('creates a file when a non-empty inline name loses focus', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })
    await openRootCreateMenu(user)
    await user.click(await screen.findByText('skill.skillManagement.detail.createFileMenu'))
    const fileNameInput = await screen.findByPlaceholderText(
      'skill.skillManagement.detail.createFile',
    )

    await user.type(fileNameInput, 'notes.md')
    await user.click(screen.getByTestId('skill-detail-sidebar-header'))

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'upsert_text',
            path: 'notes.md',
            mime_type: 'text/markdown',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('does not overwrite an existing file when creating a duplicate name', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...(createSkillDetail().files ?? []),
        {
          id: 'notes-file',
          path: 'notes.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content: '# Existing notes',
          tool_file_id: null,
          size: 16,
          hash: 'notes-hash',
        },
      ],
    })
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('notes.md')).toBeInTheDocument()
    })
    await openRootCreateMenu(user)
    await user.click(await screen.findByText('skill.skillManagement.detail.createFileMenu'))
    const fileNameInput = await screen.findByPlaceholderText(
      'skill.skillManagement.detail.createFile',
    )

    await user.type(fileNameInput, 'notes.md')
    await user.click(screen.getByTestId('skill-detail-sidebar-header'))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        'skill.skillManagement.detail.fileAlreadyExists',
      )
    })
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
  })

  it('creates a JSON file with a code-editor-compatible MIME type', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })
    await openRootCreateMenu(user)
    await user.click(await screen.findByText('skill.skillManagement.detail.createFileMenu'))
    const fileNameInput = await screen.findByPlaceholderText(
      'skill.skillManagement.detail.createFile',
    )

    await user.type(fileNameInput, 'tool.schema.json')
    await user.click(screen.getByTestId('skill-detail-sidebar-header'))

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            mime_type: 'application/json',
            operation: 'upsert_text',
            path: 'tool.schema.json',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('preserves the file list order returned by the service', async () => {
    mocks.skillDetail = createSkillDetail({
      files: [
        createSkillDetail().files![0]!,
        {
          id: 'file-2',
          path: 'scripts/example.ts',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/typescript',
          content: 'export {}\n',
          tool_file_id: null,
          size: 10,
          hash: 'hash-2',
        },
        {
          id: 'file-3',
          path: 'README.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content: '# README\n',
          tool_file_id: null,
          size: 9,
          hash: 'hash-3',
        },
        {
          id: 'file-4',
          path: 'notes.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content: '',
          tool_file_id: null,
          size: 0,
          hash: 'hash-4',
        },
      ],
    })
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('notes.md')).toBeInTheDocument()
    })

    const expectedOrder = ['SKILL.md', 'scripts', 'README.md', 'notes.md'].map(getFileTreeItem)
    for (const [index, item] of expectedOrder.entries()) {
      const nextItem = expectedOrder[index + 1]
      if (nextItem)
        expect(item.compareDocumentPosition(nextItem)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    }
  })

  it('creates a file inline inside a folder', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'scripts/example.ts',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/typescript',
          content: 'export {}\n',
          tool_file_id: null,
          size: 10,
          hash: 'hash-2',
        },
      ],
    })
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('scripts')).toBeInTheDocument()
    })
    await openFileTreeActions(user, 'scripts')
    await user.click(await screen.findByText('skill.skillManagement.detail.createFileMenu'))
    const fileNameInput = await screen.findByPlaceholderText(
      'skill.skillManagement.detail.createFile',
    )

    expect(fileNameInput.closest('ul')).toContainElement(getFileTreeItem('scripts/example.ts'))
    await user.type(fileNameInput, 'helper.ts{Enter}')

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'upsert_text',
            path: 'scripts/helper.ts',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('creates a folder inline inside a folder', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'scripts/example.ts',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/typescript',
          content: 'export {}\n',
          tool_file_id: null,
          size: 10,
          hash: 'hash-2',
        },
      ],
    })
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('scripts')).toBeInTheDocument()
    })
    await openFileTreeActions(user, 'scripts')
    await user.click(await screen.findByText('skill.skillManagement.detail.createFolderMenu'))
    const folderNameInput = await screen.findByPlaceholderText(
      'skill.skillManagement.detail.createFolder',
    )

    expect(folderNameInput.closest('ul')).toContainElement(getFileTreeItem('scripts/example.ts'))
    await user.type(folderNameInput, 'helpers{Enter}')

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'mkdir',
            path: 'scripts/helpers',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('collapses and expands nested folders from the file tree', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'scripts/example.ts',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/typescript',
          content: 'export {}\n',
          tool_file_id: null,
          size: 10,
          hash: 'hash-2',
        },
      ],
    })
    renderSkillDetailPage()

    const folder = await waitFor(() => getFileTreeButton('scripts'))
    expect(getFileTreeButton('scripts/example.ts')).toBeInTheDocument()

    await user.dblClick(folder)
    expect(document.querySelector('[title="scripts/example.ts"]')).not.toBeInTheDocument()

    await user.dblClick(folder)
    expect(getFileTreeButton('scripts/example.ts')).toBeInTheDocument()
  })

  it('uses only the native path tooltip for a file tree item', async () => {
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'scripts/example.ts',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/typescript',
          content: 'export {}\n',
          tool_file_id: null,
          size: 10,
          hash: 'hash-2',
        },
      ],
    })
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('scripts/example.ts')).toBeInTheDocument()
    })
    const fileButton = getFileTreeButton('scripts/example.ts')

    expect(fileButton).toHaveAttribute('title', 'scripts/example.ts')
    expect(screen.queryByText('scripts/example.ts')).not.toBeInTheDocument()
  })

  it('renames a file inline and selects its name without the extension', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'scripts/example.jsonl',
          kind: 'file',
          storage: 'text',
          mime_type: 'application/jsonl',
          content: '',
          tool_file_id: null,
          size: 0,
          hash: 'hash-2',
        },
      ],
    })
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('scripts/example.jsonl')).toBeInTheDocument()
    })
    await openFileTreeActions(user, 'scripts/example.jsonl')
    await user.click(await screen.findByText('common.operation.rename...'))
    const renameInput = await screen.findByDisplayValue('example.jsonl')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(renameInput).toHaveFocus()
    expect(renameInput).toHaveProperty('selectionStart', 0)
    expect(renameInput).toHaveProperty('selectionEnd', 7)

    await user.clear(renameInput)
    await user.type(renameInput, 'renamed.jsonl{Enter}')

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'rename',
            path: 'scripts/example.jsonl',
            target_path: 'scripts/renamed.jsonl',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('cancels inline rename without saving when the name is unchanged', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })
    await openFileTreeActions(user, 'SKILL.md')
    await user.click(await screen.findByText('common.operation.rename...'))
    const renameInput = await screen.findByDisplayValue('SKILL.md')

    fireEvent.keyDown(renameInput, { key: 'Enter' })

    await waitFor(() => {
      expect(renameInput).not.toBeInTheDocument()
    })
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
  })

  it('shows a toast when creating a file from the file tree fails', async () => {
    const user = userEvent.setup()
    mocks.saveDraftFileMutationFn.mockRejectedValueOnce(new Error('backend exploded'))
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })
    await openRootCreateMenu(user)
    await user.click(await screen.findByText('skill.skillManagement.detail.createFileMenu'))
    await user.type(
      await screen.findByPlaceholderText('skill.skillManagement.detail.createFile'),
      'broken.md{Enter}',
    )

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('backend exploded')
    })
  })
})
