import type { UploadConfig } from '@dify/contracts/api/console/files/types.gen'
import type { AgentConfigApiContext } from '../../config-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { AgentFileUploadDialog } from '../upload-dialog'

type UploadInput = { body: { file: File } }
type CommitInput = {
  params: { agent_id?: string; app_id?: string }
  query: { draft_type?: string; version_id?: string; node_id?: string }
  body: { upload_file_ids: string[] }
}

const mocks = vi.hoisted(() => ({
  uploadConfig: vi.fn<() => Promise<UploadConfig>>(),
  upload: vi.fn(async ({ body }: UploadInput) => ({ id: `upload-${body.file.name}` })),
  commitAgent: vi.fn(async ({ body }: CommitInput) => ({
    files: body.upload_file_ids.map((id) => ({
      name: id.replace('upload-', ''),
      file_id: id,
      mime_type: 'text/markdown',
      size: 5,
    })),
  })),
  commitWorkflow: vi.fn(async ({ body }: CommitInput) => ({
    files: body.upload_file_ids.map((id) => ({
      name: id.replace('upload-', ''),
      file_id: id,
      mime_type: 'text/markdown',
      size: 5,
    })),
  })),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'files.upload.get': mocks.uploadConfig,
      'files.upload.post': mocks.upload,
      'agent.byAgentId.config.files.batch.post': mocks.commitAgent,
      'apps.byAppId.agent.config.files.batch.post': mocks.commitWorkflow,
    }),
  }
})

const uploadKey = 'agentV2.agentDetail.configure.files.upload.'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function renderUploadDialog({
  apiContext = { agentId: 'agent-1', draftType: 'draft' },
  documentSizeLimit = 15,
  cacheUploadConfig = true,
}: {
  apiContext?: AgentConfigApiContext
  documentSizeLimit?: number
  cacheUploadConfig?: boolean
} = {}) {
  const onUploaded = vi.fn()
  const onOpenChange = vi.fn()
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  if (cacheUploadConfig) {
    queryClient.setQueryData(
      consoleQuery.files.upload.get.queryKey(),
      createFileUploadConfigFixture({ file_size_limit: documentSizeLimit }),
    )
  }

  function Harness() {
    const [open, setOpen] = useState(true)
    return (
      <AgentFileUploadDialog
        apiContext={apiContext}
        open={open}
        onOpenChange={(nextOpen) => {
          onOpenChange(nextOpen)
          setOpen(nextOpen)
        }}
        onUploaded={onUploaded}
      />
    )
  }

  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  )
  return { onUploaded, onOpenChange }
}

function markdownFile(name: string) {
  return new File(['hello'], name, { type: 'text/markdown' })
}

function fileRow(name: string) {
  const row = screen.getAllByRole('listitem').find((item) => within(item).queryByText(name))
  if (!row) throw new Error(`No upload queue item for ${name}`)
  return row
}

function uploadButton() {
  return screen.getByRole('button', { name: `${uploadKey}action` })
}

function fileInput() {
  return screen.getByLabelText(`${uploadKey}browse`, { selector: 'input' }) as HTMLInputElement
}

describe('AgentFileUploadDialog batch uploads', () => {
  beforeEach(() => {
    mocks.uploadConfig.mockReset()
    mocks.uploadConfig.mockResolvedValue(createFileUploadConfigFixture())
    mocks.upload.mockReset()
    mocks.commitAgent.mockReset()
    mocks.commitWorkflow.mockReset()
    mocks.upload.mockImplementation(async ({ body }) => ({ id: `upload-${body.file.name}` }))
    const commit = async ({ body }: CommitInput) => ({
      files: body.upload_file_ids.map((id) => ({
        name: id.replace('upload-', ''),
        file_id: id,
        mime_type: 'text/markdown',
        size: 5,
      })),
    })
    mocks.commitAgent.mockImplementation(commit)
    mocks.commitWorkflow.mockImplementation(commit)
  })

  it('waits for configured limits before accepting a selection or drop, then allows files above the default limit', async () => {
    const user = userEvent.setup()
    const uploadConfig = deferred<UploadConfig>()
    mocks.uploadConfig.mockReturnValueOnce(uploadConfig.promise)
    const { onUploaded } = renderUploadDialog({ cacheUploadConfig: false })
    const file = new File([new Uint8Array(20 * 1024 * 1024)], 'large.md', {
      type: 'text/markdown',
    })

    expect(fileInput()).toBeDisabled()
    expect(screen.getByRole('button', { name: `${uploadKey}browse` })).toBeDisabled()
    expect(screen.getByText('common.loading')).toBeInTheDocument()
    await user.upload(fileInput(), file)
    fireEvent.drop(screen.getByRole('group', { name: `${uploadKey}title` }), {
      dataTransfer: { types: ['Files'], files: [file] },
    })
    expect(screen.queryByText('large.md')).not.toBeInTheDocument()
    expect(uploadButton()).toBeDisabled()

    await act(async () =>
      uploadConfig.resolve(createFileUploadConfigFixture({ file_size_limit: 50 })),
    )
    await waitFor(() => expect(fileInput()).toBeEnabled())
    await user.upload(fileInput(), file)
    expect(within(fileRow('large.md')).getByText(`${uploadKey}queued`)).toBeInTheDocument()
    await user.click(uploadButton())

    await waitFor(() => expect(onUploaded).toHaveBeenCalledOnce())
    expect(mocks.upload).toHaveBeenCalledExactlyOnceWith({ body: { file } })
    expect(mocks.commitAgent).toHaveBeenCalledOnce()
  })

  it('uploads selected files in parallel and binds them together after all uploads finish, while protecting the running batch', async () => {
    const user = userEvent.setup()
    const firstUpload = deferred<{ id: string }>()
    const secondUpload = deferred<{ id: string }>()
    const batchCommit = deferred<Awaited<ReturnType<typeof mocks.commitAgent>>>()
    mocks.upload.mockImplementationOnce(() => firstUpload.promise)
    mocks.upload.mockImplementationOnce(() => secondUpload.promise)
    mocks.commitAgent.mockImplementationOnce(() => batchCommit.promise)
    const { onUploaded, onOpenChange } = renderUploadDialog()

    const first = markdownFile('first.md')
    const second = markdownFile('second.md')
    await user.upload(fileInput(), [first, second])
    expect(screen.getByText('first.md')).toBeInTheDocument()
    expect(screen.getByText('second.md')).toBeInTheDocument()
    await user.click(uploadButton())

    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2))
    expect(mocks.upload).toHaveBeenNthCalledWith(1, { body: { file: first } })
    expect(mocks.upload).toHaveBeenNthCalledWith(2, { body: { file: second } })
    expect(mocks.commitAgent).not.toHaveBeenCalled()
    expect(fileInput()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await user.click(uploadButton())
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(mocks.upload).toHaveBeenCalledTimes(2)

    await act(async () => secondUpload.resolve({ id: 'upload-second.md' }))
    expect(mocks.commitAgent).not.toHaveBeenCalled()
    await act(async () => firstUpload.resolve({ id: 'upload-first.md' }))
    await waitFor(() => expect(mocks.commitAgent).toHaveBeenCalledOnce())
    expect(mocks.commitAgent).toHaveBeenCalledWith({
      params: { agent_id: 'agent-1' },
      query: { draft_type: 'draft', version_id: undefined },
      body: { upload_file_ids: ['upload-first.md', 'upload-second.md'] },
    })
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    expect(onUploaded).not.toHaveBeenCalled()

    await act(async () =>
      batchCommit.resolve({
        files: ['first.md', 'second.md'].map((name) => ({
          name,
          file_id: `upload-${name}`,
          mime_type: 'text/markdown',
          size: 5,
        })),
      }),
    )
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(2))
    expect(mocks.upload.mock.calls.map(([input]) => input.body.file.name)).toEqual([
      'first.md',
      'second.md',
    ])
    expect(mocks.commitAgent).toHaveBeenCalledOnce()
    expect(onUploaded.mock.calls.map(([file]) => file.name)).toEqual(['first.md', 'second.md'])
    expect(mocks.commitWorkflow).not.toHaveBeenCalled()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false))
  })

  it('continues after an upload fails and retries only the failed file', async () => {
    const user = userEvent.setup()
    mocks.upload.mockRejectedValueOnce(new Error('Upload failed'))
    const { onUploaded } = renderUploadDialog()
    await user.upload(fileInput(), [markdownFile('retry.md'), markdownFile('ready.md')])
    await user.click(uploadButton())

    await waitFor(() => expect(onUploaded).toHaveBeenCalledOnce())
    expect(onUploaded).toHaveBeenCalledWith(expect.objectContaining({ name: 'ready.md' }))
    expect(within(fileRow('retry.md')).getByText(`${uploadKey}failed`)).toBeInTheDocument()
    expect(within(fileRow('ready.md')).getByText(`${uploadKey}success`)).toBeInTheDocument()
    await user.click(
      within(fileRow('retry.md')).getByRole('button', { name: 'common.operation.retry' }),
    )

    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(2))
    expect(mocks.upload.mock.calls.map(([input]) => input.body.file.name)).toEqual([
      'retry.md',
      'ready.md',
      'retry.md',
    ])
    expect(mocks.commitAgent.mock.calls.map(([input]) => input.body.upload_file_ids)).toEqual([
      ['upload-ready.md'],
      ['upload-retry.md'],
    ])
  })

  it('retries an atomic workflow binding with all existing uploads and preserves the workflow node context', async () => {
    const user = userEvent.setup()
    mocks.commitWorkflow.mockRejectedValueOnce(new Error('Binding failed'))
    const { onUploaded } = renderUploadDialog({
      apiContext: {
        agentId: 'agent-1',
        draftType: 'debug_build',
        versionId: 'build-1',
        workflow: { appId: 'workflow-1', nodeId: 'node-1' },
      },
    })
    await user.upload(fileInput(), [markdownFile('first.md'), markdownFile('second.md')])
    await user.click(uploadButton())
    await within(fileRow('first.md')).findByRole('button', { name: 'common.operation.retry' })
    expect(
      within(fileRow('second.md')).getByRole('button', { name: 'common.operation.retry' }),
    ).toBeEnabled()
    expect(onUploaded).not.toHaveBeenCalled()
    await user.click(uploadButton())

    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(2))
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    expect(mocks.commitAgent).not.toHaveBeenCalled()
    expect(mocks.commitWorkflow).toHaveBeenCalledTimes(2)
    expect(mocks.commitWorkflow).toHaveBeenLastCalledWith({
      params: { app_id: 'workflow-1' },
      query: { draft_type: 'debug_build', version_id: 'build-1', node_id: 'node-1' },
      body: { upload_file_ids: ['upload-first.md', 'upload-second.md'] },
    })
  })

  it('inserts only the final file returned for duplicate names in a successful batch', async () => {
    const user = userEvent.setup()
    mocks.upload
      .mockResolvedValueOnce({ id: 'earlier-upload' })
      .mockResolvedValueOnce({ id: 'latest-upload' })
    mocks.commitAgent.mockResolvedValueOnce({
      files: [{ name: 'same.md', file_id: 'latest-upload', mime_type: 'text/markdown', size: 5 }],
    })
    const { onUploaded, onOpenChange } = renderUploadDialog()
    await user.upload(fileInput(), [markdownFile('same.md'), markdownFile('same.md')])
    await user.click(uploadButton())

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false))
    expect(mocks.commitAgent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        body: { upload_file_ids: ['earlier-upload', 'latest-upload'] },
      }),
    )
    expect(onUploaded).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: 'same.md',
        fileId: 'latest-upload',
      }),
    )
  })

  it('accepts a drop containing multiple files and keeps an oversized file error separate from valid queued files', async () => {
    const user = userEvent.setup()
    const { onUploaded } = renderUploadDialog({ documentSizeLimit: 1 })
    const first = markdownFile('first.md')
    const oversized = new File([new Uint8Array(1024 * 1024 + 1)], 'large.md', {
      type: 'text/markdown',
    })
    const second = markdownFile('second.md')
    fireEvent.drop(screen.getByRole('group', { name: `${uploadKey}title` }), {
      dataTransfer: { types: ['Files'], files: [first, oversized, second] },
    })

    expect(
      within(fileRow('large.md')).getByText(/common\.fileUploader\.uploadFromComputerLimit/),
    ).toHaveTextContent('1.00 MB')
    expect(
      within(fileRow('large.md')).queryByRole('button', { name: 'common.operation.retry' }),
    ).not.toBeInTheDocument()
    await user.click(uploadButton())

    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(2))
    expect(mocks.upload.mock.calls.map(([input]) => input.body.file.name)).toEqual([
      'first.md',
      'second.md',
    ])
    expect(mocks.commitAgent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        body: { upload_file_ids: ['upload-first.md', 'upload-second.md'] },
      }),
    )
    expect(screen.getByText('large.md')).toBeInTheDocument()
  })
})
