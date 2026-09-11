import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  confirmUploadReview,
  createDataTransfer,
  createSkillDetail,
  getFileTreeContextRegion,
  getFileTreeItem,
  getMocks,
  renderSkillDetailPage,
  resetDetailPageFixture,
} from './detail-page.fixture'

const mocks = getMocks()

describe('SkillDetailPage uploads', () => {
  beforeEach(resetDetailPageFixture)

  it('uploads externally dragged files to the root file list', async () => {
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })
    const upload = new File(['root'], 'root-guide.md', { type: 'text/markdown' })
    const { dataTransfer } = createDataTransfer([upload])
    const contextRegion = getFileTreeContextRegion()

    fireEvent.dragOver(contextRegion, { dataTransfer })

    expect(screen.getByText(/^Upload to/)).toHaveTextContent(/^Upload to root folder$/)

    fireEvent.drop(contextRegion, { dataTransfer })
    await confirmUploadReview()

    await waitFor(() => {
      expect(mocks.uploadSkillFile).toHaveBeenCalledWith(
        upload,
        expect.objectContaining({
          onProgress: expect.any(Function),
          xhr: expect.any(XMLHttpRequest),
        }),
      )
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'upsert_tool_file',
            path: 'root-guide.md',
            tool_file_id: 'tool-file-1',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('reviews backend file checks and applies keep-both, suggestion, and skip decisions', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          content: null,
          hash: 'report-hash',
          id: 'report-file',
          kind: 'file',
          mime_type: 'application/pdf',
          path: 'report.pdf',
          size: 3,
          storage: 'tool_file',
          tool_file_id: 'existing-report',
        },
      ],
    })
    mocks.checkDraftFilesMutationFn.mockResolvedValueOnce({
      data: {
        'my notes!.md': {
          errors: [{ code: 'invalid_filename', message: 'filename is invalid' }],
          extension: '.md',
          filename: 'my notes!.md',
          mime_type: 'text/markdown',
          path: 'my notes!.md',
          size: 5,
        },
        'report.abcd': {
          errors: [{ code: 'invalid_file_extension', message: 'extension is invalid' }],
          extension: '.abcd',
          filename: 'report.abcd',
          mime_type: 'application/octet-stream',
          path: 'report.abcd',
          size: 4,
        },
        'report.pdf': {
          errors: [{ code: 'file_already_exists', message: 'file already exists' }],
          extension: '.pdf',
          filename: 'report.pdf',
          mime_type: 'application/pdf',
          path: 'report.pdf',
          size: 3,
        },
      },
    })
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })

    const uploads = [
      new File(['pdf'], 'report.pdf', { type: 'application/pdf' }),
      new File(['notes'], 'my notes!.md', { type: 'text/markdown' }),
      new File(['bad'], 'report.abcd'),
    ]
    fireEvent.drop(getFileTreeContextRegion(), {
      dataTransfer: createDataTransfer(uploads).dataTransfer,
    })

    const initialUploadButton = await screen.findByRole('button', { name: /uploadFilesButton/ })
    expect(initialUploadButton).toBeDisabled()
    expect(screen.getByText(/uploadSkippedGroup/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /uploadKeepBoth/ }))
    await user.click(screen.getByRole('button', { name: /uploadSuggestion/ }))
    const resolvedUploadButton = screen.getByRole('button', { name: /uploadFilesButton/ })
    expect(resolvedUploadButton).toBeEnabled()
    await user.click(resolvedUploadButton)

    await waitFor(() => {
      expect(mocks.uploadSkillFile).toHaveBeenCalledTimes(2)
      expect(
        mocks.saveDraftFileMutationFn.mock.calls.map(([request]) => request.body.path),
      ).toEqual(expect.arrayContaining(['report-2.pdf', 'my-notes.md']))
    })
  })

  it('uploads externally dragged files to the highlighted folder', async () => {
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'directory-1',
          path: 'references',
          kind: 'directory',
          storage: 'text',
          mime_type: null,
          content: null,
          tool_file_id: null,
          size: 0,
          hash: 'directory-hash',
        },
      ],
    })
    renderSkillDetailPage()

    const folder = await waitFor(() => getFileTreeItem('references'))
    const upload = new File(['guide'], 'guide.md', { type: 'text/markdown' })
    const { dataTransfer } = createDataTransfer([upload])
    fireEvent.dragOver(folder.closest('li')!, { dataTransfer })

    expect(screen.getByText(/^Upload to/)).toHaveTextContent(/^Upload to references$/)

    fireEvent.drop(folder.closest('li')!, { dataTransfer })
    await confirmUploadReview()

    await waitFor(() => {
      expect(mocks.uploadSkillFile).toHaveBeenCalledWith(
        upload,
        expect.objectContaining({
          onProgress: expect.any(Function),
          xhr: expect.any(XMLHttpRequest),
        }),
      )
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'upsert_tool_file',
            path: 'references/guide.md',
            tool_file_id: 'tool-file-1',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('cancels an active file upload from the upload status panel', async () => {
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'directory-1',
          path: 'references',
          kind: 'directory',
          storage: 'text',
          mime_type: null,
          content: null,
          tool_file_id: null,
          size: 0,
          hash: 'directory-hash',
        },
      ],
    })
    mocks.uploadSkillFile.mockImplementation(() => new Promise(() => undefined))
    const abortSpy = vi.spyOn(XMLHttpRequest.prototype, 'abort').mockImplementation(() => undefined)
    renderSkillDetailPage()

    const folder = await waitFor(() => getFileTreeItem('references'))
    const upload = new File(['guide'], 'guide.md', { type: 'text/markdown' })
    fireEvent.drop(folder.closest('li')!, {
      dataTransfer: createDataTransfer([upload]).dataTransfer,
    })
    await confirmUploadReview()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(abortSpy).toHaveBeenCalledOnce()
  })

  it('retries failed file uploads from the upload status panel', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'directory-1',
          path: 'references',
          kind: 'directory',
          storage: 'text',
          mime_type: null,
          content: null,
          tool_file_id: null,
          size: 0,
          hash: 'directory-hash',
        },
      ],
    })
    mocks.uploadSkillFile
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce({
        id: 'tool-file-retry',
        name: 'guide.md',
        mime_type: 'text/markdown',
        size: 5,
      })
    renderSkillDetailPage()

    const folder = await waitFor(() => getFileTreeItem('references'))
    const upload = new File(['guide'], 'guide.md', { type: 'text/markdown' })
    fireEvent.drop(folder.closest('li')!, {
      dataTransfer: createDataTransfer([upload]).dataTransfer,
    })
    await confirmUploadReview()

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        'skill.skillManagement.detail.uploadFilesFailedStatus:{"count":1}',
      )
    })

    await user.click(screen.getByRole('button', { name: /viewUploadErrors/ }))
    await user.click(screen.getAllByRole('button', { name: 'common.operation.retry' })[0]!)

    await waitFor(() => {
      expect(mocks.uploadSkillFile).toHaveBeenCalledTimes(2)
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'upsert_tool_file',
            path: 'references/guide.md',
            tool_file_id: 'tool-file-retry',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('offers replace, keep-both, and skip when a file appears during upload', async () => {
    const user = userEvent.setup()
    const initialDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          content: null,
          hash: 'directory-hash',
          id: 'directory-1',
          kind: 'directory',
          mime_type: null,
          path: 'references',
          size: 0,
          storage: 'text',
          tool_file_id: null,
        },
      ],
    })
    mocks.skillDetail = initialDetail
    mocks.saveDraftFileMutationFn
      .mockImplementationOnce(async () => {
        mocks.skillDetail = createSkillDetail({
          updated_at: initialDetail.updated_at + 1,
          files: [
            ...initialDetail.files!,
            {
              content: null,
              hash: 'late-guide-hash',
              id: 'late-guide',
              kind: 'file',
              mime_type: 'text/markdown',
              path: 'references/guide.md',
              size: 5,
              storage: 'tool_file',
              tool_file_id: 'late-guide-tool-file',
            },
          ],
        })
        throw new Response(
          JSON.stringify({
            code: 'skill_conflict',
            message: 'skill has been modified by another user',
          }),
          { status: 409 },
        )
      })
      .mockImplementationOnce(async () => {
        mocks.skillDetail = createSkillDetail({ updated_at: initialDetail.updated_at + 2 })
        return mocks.skillDetail
      })
    renderSkillDetailPage()

    const folder = await waitFor(() => getFileTreeItem('references'))
    const upload = new File(['guide'], 'guide.md', { type: 'text/markdown' })
    fireEvent.drop(folder.closest('li')!, {
      dataTransfer: createDataTransfer([upload]).dataTransfer,
    })
    await confirmUploadReview()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /viewUploadErrors/ })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /viewUploadErrors/ }))
    expect(screen.getByText(/uploadLateConflict/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /uploadReplace/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /uploadSkip/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /uploadKeepBoth/ }))

    await waitFor(() => {
      expect(mocks.uploadSkillFile).toHaveBeenCalledTimes(2)
      expect(mocks.saveDraftFileMutationFn).toHaveBeenLastCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ path: 'references/guide-2.md' }),
        }),
        expect.anything(),
      )
    })
  })
})
