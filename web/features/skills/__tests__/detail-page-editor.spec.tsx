import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  createSkillDetail,
  getFileTreeButton,
  getMocks,
  renderSkillDetailPage,
  resetDetailPageFixture,
} from './detail-page.fixture'

const mocks = getMocks()

describe('SkillDetailPage editor', () => {
  beforeEach(resetDetailPageFixture)

  it('does not render the markdown editor before external file content loads', async () => {
    mocks.fetchSkillFileBlob.mockImplementation(() => new Promise<Blob>(() => undefined))
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'references/guide.md',
          kind: 'file',
          storage: 'tool_file',
          mime_type: 'text/markdown',
          content: null,
          tool_file_id: 'tool-file-guide',
          size: 128,
          hash: 'hash-2',
        },
      ],
    })
    const { container } = renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    fireEvent.click(getFileTreeButton('references/guide.md'))

    await waitFor(() => {
      expect(mocks.fetchSkillFileBlob).toHaveBeenCalledOnce()
    })
    expect(container.querySelector('[contenteditable="true"]')).not.toBeInTheDocument()
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
  })

  it('loads external text file content into the editor', async () => {
    const user = userEvent.setup()
    mocks.fetchSkillFileBlob.mockResolvedValue(new Blob(['# Loaded guide']))
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'references/guide.md',
          kind: 'file',
          storage: 'tool_file',
          mime_type: 'text/markdown',
          content: null,
          tool_file_id: 'tool-file-guide',
          size: 128,
          hash: 'hash-2',
        },
      ],
    })

    renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    await user.click(getFileTreeButton('references/guide.md'))

    expect(await screen.findByText('# Loaded guide')).toBeInTheDocument()
    await user.click(
      screen.getByRole('textbox', {
        name: 'skill.skillManagement.detail.referenceFiles.livePlaceholder',
      }),
    )
    await waitFor(() => {
      const editor = screen.getByRole('textbox', {
        name: 'skill.skillManagement.detail.referenceFiles.livePlaceholder',
      })
      expect(editor).toHaveAttribute('contenteditable', 'true')
      expect(editor).toHaveTextContent('# Loaded guide')
    })
    expect(mocks.fetchSkillFileBlob).toHaveBeenCalledWith({
      path: 'references/guide.md',
      skillId: 'skill-1',
      versionId: null,
    })
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
  })

  it('does not render the code editor when external file content fails to load', async () => {
    mocks.fetchSkillFileBlob.mockRejectedValue(new Error('content unavailable'))
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'scripts/action.ts',
          kind: 'file',
          storage: 'tool_file',
          mime_type: 'text/typescript',
          content: null,
          tool_file_id: 'tool-file-action',
          size: 128,
          hash: 'hash-2',
        },
      ],
    })
    renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    fireEvent.click(getFileTreeButton('scripts/action.ts'))

    expect(await screen.findByText('skill.skillManagement.detail.loadFailed')).toBeInTheDocument()
    expect(screen.queryByLabelText('code-editor')).not.toBeInTheDocument()
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
  })

  it('renders CSV files as a table preview', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-csv',
          path: 'references/refunds.csv',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/csv',
          content: 'Policy,Window\nStandard,7 days\nEscalated,Manual review',
          tool_file_id: null,
          size: 55,
          hash: 'hash-csv',
        },
      ],
    })

    renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    await user.click(getFileTreeButton('references/refunds.csv'))

    expect(screen.getByRole('columnheader', { name: 'Policy' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Window' })).toBeInTheDocument()
    expect(screen.getByText('Standard')).toBeInTheDocument()
    expect(screen.getByText('7 days')).toBeInTheDocument()
    expect(screen.queryByLabelText('code-editor')).not.toBeInTheDocument()
  })

  it('shows an unsupported preview for non-previewable binary files', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-bin',
          path: 'assets/archive.bin',
          kind: 'file',
          storage: 'tool_file',
          mime_type: 'application/octet-stream',
          content: null,
          tool_file_id: 'tool-file-bin',
          size: 42,
          hash: 'hash-bin',
        },
      ],
    })

    renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    await user.click(getFileTreeButton('assets/archive.bin'))

    expect(screen.getByText('skill.skillManagement.detail.previewUnsupported')).toBeInTheDocument()
    expect(
      screen.getByText(
        'skill.skillManagement.detail.fileMeta:{"size":42,"type":"application/octet-stream"}',
      ),
    ).toBeInTheDocument()
    expect(mocks.fetchSkillFileBlob).not.toHaveBeenCalled()
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
  })

  it('downloads unsupported binary files on request', async () => {
    const user = userEvent.setup()
    mocks.fetchSkillFileBlob.mockResolvedValue(new Blob(['binary']))
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-bin',
          path: 'assets/archive.bin',
          kind: 'file',
          storage: 'tool_file',
          mime_type: 'application/octet-stream',
          content: null,
          tool_file_id: 'tool-file-bin',
          size: 42,
          hash: 'hash-bin',
        },
      ],
    })

    renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    await user.click(getFileTreeButton('assets/archive.bin'))
    await user.click(
      screen.getByRole('button', { name: /skill\.skillManagement\.detail\.downloadFile/ }),
    )

    await waitFor(() => {
      expect(mocks.fetchSkillFileBlob).toHaveBeenCalledWith({
        download: true,
        path: 'assets/archive.bin',
        skillId: 'skill-1',
        versionId: null,
      })
    })
  })

  it('shows a toast when downloading a binary file fails', async () => {
    const user = userEvent.setup()
    mocks.fetchSkillFileBlob.mockRejectedValue(new Error('download failed'))
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-bin',
          path: 'assets/archive.bin',
          kind: 'file',
          storage: 'tool_file',
          mime_type: 'application/octet-stream',
          content: null,
          tool_file_id: 'tool-file-bin',
          size: 42,
          hash: 'hash-bin',
        },
      ],
    })

    renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    await user.click(getFileTreeButton('assets/archive.bin'))
    await user.click(
      screen.getByRole('button', { name: /skill\.skillManagement\.detail\.downloadFile/ }),
    )

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('skill.skillManagement.detail.loadFailed')
    })
  })

  it('renders image tool files after loading their preview blob', async () => {
    const user = userEvent.setup()
    const imageBlob = new Blob(['image'], { type: 'image/png' })
    let previewUrlIndex = 0
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => `blob:image-preview-${++previewUrlIndex}`)
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL')
    mocks.fetchSkillFileBlob.mockResolvedValue(imageBlob)
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-image',
          path: 'assets/logo.png',
          kind: 'file',
          storage: 'tool_file',
          mime_type: 'image/png',
          content: null,
          tool_file_id: 'tool-file-image',
          size: 128,
          hash: 'hash-image',
        },
      ],
    })

    const { unmount } = renderSkillDetailPage({ strict: true })

    await screen.findByText('skill.skillManagement.detail.builder.title')
    await user.click(getFileTreeButton('assets/logo.png'))

    const preview = await screen.findByAltText('assets/logo.png')
    const activePreviewUrl = createObjectURL.mock.results.at(-1)?.value
    expect(preview).toBeInTheDocument()
    expect(preview).toHaveAttribute('src', activePreviewUrl)
    expect(revokeObjectURL).not.toHaveBeenCalledWith(activePreviewUrl)
    expect(mocks.fetchSkillFileBlob).toHaveBeenCalledWith({
      path: 'assets/logo.png',
      skillId: 'skill-1',
      versionId: null,
    })

    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith(activePreviewUrl)
    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
  })

  it('shows an image preview error when the tool file blob cannot be loaded', async () => {
    const user = userEvent.setup()
    mocks.fetchSkillFileBlob.mockRejectedValue(new Error('preview unavailable'))
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-image',
          path: 'assets/logo.png',
          kind: 'file',
          storage: 'tool_file',
          mime_type: 'image/png',
          content: null,
          tool_file_id: 'tool-file-image',
          size: 128,
          hash: 'hash-image',
        },
      ],
    })

    renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    await user.click(getFileTreeButton('assets/logo.png'))

    expect(await screen.findByText('skill.skillManagement.detail.loadFailed')).toBeInTheDocument()
  })

  it('keeps line breaks typed in the live markdown editor', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        {
          id: 'file-1',
          path: 'SKILL.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content:
            '---\nname: github-actions-failure-debugging\ndescription: Guide for debugging failing GitHub Actions workflows.\nmetadata:\n  display-name: Untitled skill\n---\n',
          tool_file_id: null,
          size: 148,
          hash: 'hash-1',
        },
      ],
    })

    renderSkillDetailPage()

    const textboxes = await screen.findAllByRole('textbox')
    const liveEditor = textboxes.find(
      (textbox): textbox is HTMLDivElement =>
        textbox instanceof HTMLDivElement && textbox.isContentEditable,
    )
    if (!liveEditor) throw new Error('live editor not found')

    await user.click(liveEditor)
    await user.type(liveEditor, 'First line{Enter}Second line')
    await user.click(
      screen.getByRole('button', { name: 'skill.skillManagement.detail.publishUpdate' }),
    )

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            content: expect.stringContaining('First line\nSecond line'),
          }),
        }),
        expect.anything(),
      )
    })
  }, 15000)
})
