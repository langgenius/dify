import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  createDataTransfer,
  createSkillDetail,
  getFileTreeButton,
  getFileTreeContextRegion,
  getFileTreeItem,
  getMocks,
  openFileTreeActions,
  primaryModifier,
  renderSkillDetailPage,
  resetDetailPageFixture,
} from './detail-page.fixture'

const mocks = getMocks()

function createSelectionSkillDetail() {
  return createSkillDetail({
    files: [
      ...createSkillDetail().files!,
      {
        id: 'file-readme',
        path: 'README.md',
        kind: 'file',
        storage: 'text',
        mime_type: 'text/markdown',
        content: '# README',
        tool_file_id: null,
        size: 8,
        hash: 'hash-readme',
      },
      {
        id: 'file-example',
        path: 'scripts/example.ts',
        kind: 'file',
        storage: 'text',
        mime_type: 'text/typescript',
        content: 'export {}\n',
        tool_file_id: null,
        size: 10,
        hash: 'hash-example',
      },
      {
        id: 'directory-references',
        path: 'references',
        kind: 'directory',
        storage: 'text',
        mime_type: null,
        content: null,
        tool_file_id: null,
        size: 0,
        hash: 'hash-references',
      },
    ],
  })
}

describe('SkillDetailPage clipboard', () => {
  beforeEach(resetDetailPageFixture)

  it('copies the context-menu file with the displayed keyboard shortcut', async () => {
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })
    fireEvent.contextMenu(getFileTreeItem('SKILL.md'), {
      button: 2,
      clientX: 120,
      clientY: 240,
    })
    await screen.findByText('common.operation.rename...')

    const copyMenuItem = screen.getByRole('menuitem', {
      name: /skillManagement\.detail\.copyFile/,
    })
    copyMenuItem.addEventListener('keydown', (event) => event.stopPropagation())
    fireEvent.keyDown(copyMenuItem, {
      code: 'KeyC',
      key: 'c',
      ...primaryModifier,
    })

    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'skill.skillManagement.detail.copyContentSuccess',
    )
  })

  it('cuts the context-menu file with the displayed keyboard shortcut', async () => {
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })
    fireEvent.contextMenu(getFileTreeItem('SKILL.md'), {
      button: 2,
      clientX: 120,
      clientY: 240,
    })
    await screen.findByText('common.operation.rename...')

    const cutMenuItem = screen.getByRole('menuitem', {
      name: /skill\.skillManagement\.detail\.cutFile/,
    })
    cutMenuItem.addEventListener('keydown', (event) => event.stopPropagation())
    fireEvent.keyDown(cutMenuItem, {
      code: 'KeyX',
      key: 'x',
      ...primaryModifier,
    })

    expect(mocks.toastSuccess).toHaveBeenCalledWith('skill.skillManagement.detail.cutFileSuccess')
  })

  it('copies a file with the keyboard shortcut and pastes it into the selected folder', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          kind: 'directory',
          path: 'scripts',
          size: 0,
        },
      ],
    })
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeButton('SKILL.md')).toBeInTheDocument()
    })
    await user.click(getFileTreeButton('SKILL.md'))
    fireEvent.copy(getFileTreeButton('SKILL.md'))
    await user.click(screen.getByRole('button', { name: 'scripts' }))
    fireEvent.paste(screen.getByTestId('skill-detail-sidebar'))

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'upsert_text',
            path: 'scripts/SKILL.md',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('lets editable fields handle native copy even when page selection contains an empty draft marker', async () => {
    const user = userEvent.setup()
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => '<!-- dify-skill-empty-draft -->',
    } as Selection)
    try {
      renderSkillDetailPage()

      await waitFor(() => {
        expect(getFileTreeButton('SKILL.md')).toBeInTheDocument()
      })
      await user.click(getFileTreeButton('SKILL.md'))
      const builderInput = screen.getByPlaceholderText(
        'skill.skillManagement.detail.builder.modifyPlaceholder',
      )
      fireEvent.copy(builderInput)

      expect(mocks.copyToClipboard).not.toHaveBeenCalledWith('<!-- dify-skill-empty-draft -->')
      expect(mocks.toastSuccess).not.toHaveBeenCalledWith(
        'skill.skillManagement.detail.copyContentSuccess',
      )
      expect(mocks.toastSuccess).not.toHaveBeenCalledWith(
        'skill.skillManagement.detail.copyFileSuccess',
      )
    } finally {
      getSelectionSpy.mockRestore()
    }
  })

  it('does not let file-tree copy hotkeys override copying from the builder panel', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeButton('SKILL.md')).toBeInTheDocument()
    })
    await user.click(getFileTreeButton('SKILL.md'))

    const builderControl = screen.getByRole('button', {
      name: 'skill.skillManagement.detail.builder.close',
    })
    fireEvent.keyDown(builderControl, {
      code: 'KeyC',
      key: 'c',
      ...primaryModifier,
    })

    expect(mocks.copyToClipboard).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith(
      'skill.skillManagement.detail.copyContentSuccess',
    )
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith(
      'skill.skillManagement.detail.copyFileSuccess',
    )
  })

  it('opens only the copied file after pasting it beside the source file', async () => {
    const user = userEvent.setup()
    const sourceFile = createSkillDetail().files![0]!
    const copiedFile = {
      ...sourceFile,
      id: 'file-2',
      path: 'SKILL copy.md',
      hash: 'hash-2',
    }
    mocks.saveDraftFileMutationFn.mockImplementationOnce(async () => {
      mocks.skillDetail = createSkillDetail({
        updated_at: 1784638490,
        files: [sourceFile, copiedFile],
      })
      return mocks.skillDetail
    })
    mocks.skillDetailKey.mockReturnValue(['skill-detail'])
    mocks.skillDetailQueryOptions.mockImplementation(() => ({
      queryKey: ['skill-detail'],
      queryFn: async () => mocks.skillDetail,
    }))
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeButton('SKILL.md')).toBeInTheDocument()
    })
    await user.click(getFileTreeButton('SKILL.md'))
    fireEvent.copy(getFileTreeButton('SKILL.md'))
    fireEvent.paste(screen.getByTestId('skill-detail-sidebar'))

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'upsert_text',
            path: 'SKILL copy.md',
          }),
        }),
        expect.anything(),
      )
    })
    await waitFor(() => {
      const editorMain = screen.getAllByRole('main').at(-1)
      if (!editorMain) throw new Error('file editor not found')
      expect(
        within(editorMain).getByRole('button', {
          name: 'SKILL copy.md',
        }),
      ).toBeInTheDocument()
    })
  })

  it('refreshes and retries a paste once when its skill timestamp is stale', async () => {
    const user = userEvent.setup()
    const sourceFile = createSkillDetail().files![0]!
    const latestDetail = createSkillDetail({
      updated_at: 1784638490,
      files: [sourceFile],
    })
    const copiedDetail = createSkillDetail({
      updated_at: 1784638491,
      files: [
        sourceFile,
        {
          ...sourceFile,
          id: 'file-2',
          path: 'SKILL copy.md',
          hash: 'hash-2',
        },
      ],
    })
    const conflict = new Error('skill has been modified by another user') as Error & {
      code: string
      details: {
        current_updated_at: number
        expected_updated_at: number
      }
    }
    conflict.code = 'skill_conflict'
    conflict.details = {
      current_updated_at: latestDetail.updated_at,
      expected_updated_at: 1784638487,
    }
    mocks.saveDraftFileMutationFn
      .mockRejectedValueOnce(conflict)
      .mockImplementationOnce(async () => {
        mocks.skillDetail = copiedDetail
        return copiedDetail
      })
    mocks.skillDetailGetFn.mockResolvedValueOnce(latestDetail)
    mocks.skillDetailKey.mockReturnValue(['skill-detail'])
    mocks.skillDetailQueryOptions.mockImplementation(() => ({
      queryKey: ['skill-detail'],
      queryFn: async () => mocks.skillDetail,
    }))
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeButton('SKILL.md')).toBeInTheDocument()
    })
    await user.click(getFileTreeButton('SKILL.md'))
    fireEvent.copy(getFileTreeButton('SKILL.md'))
    fireEvent.paste(screen.getByTestId('skill-detail-sidebar'))

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledTimes(2)
    })
    expect(mocks.saveDraftFileMutationFn.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        body: expect.objectContaining({
          expected_updated_at: latestDetail.updated_at,
          operation: 'upsert_text',
          path: 'SKILL copy.md',
        }),
      }),
    )
    expect(mocks.toastError).not.toHaveBeenCalledWith('skill has been modified by another user')
  })

  it('retries only the current file when a multi-file paste becomes stale', async () => {
    const user = userEvent.setup()
    const sourceFiles = [
      {
        ...createSkillDetail().files![0]!,
        id: 'file-1',
        path: 'alpha.md',
      },
      {
        ...createSkillDetail().files![0]!,
        id: 'file-2',
        path: 'beta.md',
        hash: 'hash-2',
      },
    ]
    const copiedAlpha = {
      ...sourceFiles[0]!,
      id: 'file-3',
      path: 'alpha copy.md',
      hash: 'hash-3',
    }
    const afterAlphaCopy = createSkillDetail({
      updated_at: 1784638488,
      files: [...sourceFiles, copiedAlpha],
    })
    const refreshedDetail = createSkillDetail({
      updated_at: 1784638490,
      files: [...sourceFiles, copiedAlpha],
    })
    const copiedBeta = {
      ...sourceFiles[1]!,
      id: 'file-4',
      path: 'beta copy.md',
      hash: 'hash-4',
    }
    const afterBetaCopy = createSkillDetail({
      updated_at: 1784638491,
      files: [...sourceFiles, copiedAlpha, copiedBeta],
    })
    const conflict = new Error('skill has been modified by another user') as Error & {
      code: string
    }
    conflict.code = 'skill_conflict'

    mocks.skillDetail = createSkillDetail({ files: sourceFiles })
    mocks.saveDraftFileMutationFn
      .mockResolvedValueOnce(afterAlphaCopy)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(afterBetaCopy)
    mocks.skillDetailGetFn.mockResolvedValueOnce(refreshedDetail)
    mocks.skillDetailKey.mockReturnValue(['skill-detail'])
    mocks.skillDetailQueryOptions.mockImplementation(() => ({
      queryKey: ['skill-detail'],
      queryFn: async () => mocks.skillDetail,
    }))
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeButton('alpha.md')).toBeInTheDocument()
    })
    await user.click(getFileTreeButton('alpha.md'))
    fireEvent.click(getFileTreeButton('beta.md'), primaryModifier)
    fireEvent.copy(getFileTreeButton('beta.md'))
    fireEvent.paste(screen.getByTestId('skill-detail-sidebar'))

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledTimes(3)
    })
    expect(mocks.saveDraftFileMutationFn.mock.calls.map(([request]) => request.body.path)).toEqual([
      'alpha copy.md',
      'beta copy.md',
      'beta copy.md',
    ])
    expect(mocks.saveDraftFileMutationFn.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({
        body: expect.objectContaining({
          expected_updated_at: refreshedDetail.updated_at,
        }),
      }),
    )
  })

  it('cuts a nested file and pastes it into the root after selecting the blank area', async () => {
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

    await user.click(await screen.findByRole('button', { name: 'example.ts' }))
    fireEvent.cut(getFileTreeButton('scripts/example.ts'))
    const contextRegion = document.querySelector('[data-skill-file-tree-context-region]')
    if (!(contextRegion instanceof HTMLElement))
      throw new Error('file tree context region not found')
    fireEvent.contextMenu(contextRegion, {
      button: 2,
      clientX: 160,
      clientY: 520,
    })
    const rootMenuItem = (
      await screen.findByText('skill.skillManagement.detail.createFileMenu')
    ).closest('[role="menuitem"]')
    if (!(rootMenuItem instanceof HTMLElement)) throw new Error('root menu item not found')
    fireEvent.keyDown(rootMenuItem, {
      code: 'KeyV',
      key: 'v',
      ...primaryModifier,
    })

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'rename',
            path: 'scripts/example.ts',
            target_path: 'example.ts',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('creates a file from the file-list blank-area context menu', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    const contextRegion = await waitFor(() => getFileTreeContextRegion())
    fireEvent.contextMenu(contextRegion, {
      button: 2,
      clientX: 160,
      clientY: 520,
    })
    await user.click(await screen.findByText('skill.skillManagement.detail.createFileMenu'))
    await user.type(
      await screen.findByPlaceholderText('skill.skillManagement.detail.createFile'),
      'from-context.md{Enter}',
    )

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'upsert_text',
            path: 'from-context.md',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('moves the complete multi-selection into the dropped folder', async () => {
    mocks.skillDetail = createSelectionSkillDetail()
    renderSkillDetailPage()

    await waitFor(() => expect(getFileTreeItem('SKILL.md')).toBeInTheDocument())
    const exampleFile = getFileTreeItem('scripts/example.ts')
    const targetFolder = getFileTreeItem('references')
    fireEvent.click(getFileTreeButton('SKILL.md'))
    fireEvent.click(getFileTreeButton('scripts/example.ts'), { metaKey: true })

    const { dataTransfer } = createDataTransfer()
    fireEvent.dragStart(exampleFile, { dataTransfer })

    fireEvent.dragOver(targetFolder.closest('li')!, { dataTransfer })
    expect(screen.getByText(/^Move to/)).toHaveTextContent(/^Move to references$/)
    fireEvent.drop(targetFolder.closest('li')!, { dataTransfer })

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'rename',
            path: 'SKILL.md',
            target_path: 'references/SKILL.md',
          }),
        }),
        expect.anything(),
      )
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'rename',
            path: 'scripts/example.ts',
            target_path: 'references/example.ts',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('moves the full file range selected with Shift-click', async () => {
    mocks.skillDetail = createSelectionSkillDetail()
    renderSkillDetailPage()

    await waitFor(() => expect(getFileTreeButton('scripts/example.ts')).toBeInTheDocument())
    const exampleFile = getFileTreeItem('scripts/example.ts')
    const targetFolder = getFileTreeItem('references')
    fireEvent.click(getFileTreeButton('SKILL.md'))
    fireEvent.click(getFileTreeButton('scripts/example.ts'), { shiftKey: true })

    const { dataTransfer } = createDataTransfer()
    fireEvent.dragStart(exampleFile, { dataTransfer })
    fireEvent.dragOver(targetFolder.closest('li')!, { dataTransfer })
    fireEvent.drop(targetFolder.closest('li')!, { dataTransfer })

    await waitFor(() => {
      for (const [path, targetPath] of [
        ['SKILL.md', 'references/SKILL.md'],
        ['README.md', 'references/README.md'],
        ['scripts', 'references/scripts'],
      ]) {
        expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({
              operation: 'rename',
              path,
              target_path: targetPath,
            }),
          }),
          expect.anything(),
        )
      }
    })
  })

  it('clears the previous multi-selection before dragging from the file-list blank area', async () => {
    mocks.skillDetail = createSelectionSkillDetail()
    renderSkillDetailPage()

    await waitFor(() => expect(getFileTreeButton('scripts/example.ts')).toBeInTheDocument())
    fireEvent.click(getFileTreeButton('SKILL.md'))
    fireEvent.click(getFileTreeButton('README.md'), primaryModifier)
    fireEvent.click(getFileTreeContextRegion())

    const exampleFile = getFileTreeItem('scripts/example.ts')
    const targetFolder = getFileTreeItem('references')
    const { dataTransfer } = createDataTransfer()
    fireEvent.dragStart(exampleFile, { dataTransfer })
    fireEvent.dragOver(targetFolder.closest('li')!, { dataTransfer })
    fireEvent.drop(targetFolder.closest('li')!, { dataTransfer })

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'rename',
            path: 'scripts/example.ts',
            target_path: 'references/example.ts',
          }),
        }),
        expect.anything(),
      )
    })
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          operation: 'rename',
          path: 'SKILL.md',
        }),
      }),
      expect.anything(),
    )
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          operation: 'rename',
          path: 'README.md',
        }),
      }),
      expect.anything(),
    )
  })

  it('expands a collapsed folder after a two-second drag hover', async () => {
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

    const folder = await waitFor(() => getFileTreeItem('scripts'))
    await user.dblClick(getFileTreeButton('scripts'))
    expect(document.querySelector('[title="scripts/example.ts"]')).not.toBeInTheDocument()

    vi.useFakeTimers()
    try {
      const { dataTransfer } = createDataTransfer([new File(['x'], 'x.txt')])
      fireEvent.dragOver(folder.closest('li')!, { dataTransfer })
      act(() => vi.advanceTimersByTime(1999))
      expect(document.querySelector('[title="scripts/example.ts"]')).not.toBeInTheDocument()
      act(() => vi.advanceTimersByTime(1))
      expect(getFileTreeItem('scripts/example.ts')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('deletes a file through the file tree action menu', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })
    await openFileTreeActions(user, 'SKILL.md')
    await user.click(await screen.findByText('common.operation.delete'))
    const dialog = await screen.findByRole('alertdialog')

    await user.click(within(dialog).getByRole('button', { name: 'common.operation.delete' }))

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            expected_updated_at: 1784638487,
            operation: 'delete',
            path: 'SKILL.md',
          }),
        }),
        expect.anything(),
      )
    })
  })
})
