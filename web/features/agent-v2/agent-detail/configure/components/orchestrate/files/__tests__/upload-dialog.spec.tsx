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
  body: { upload_file_id: string }
}

const mocks = vi.hoisted(() => ({
  upload: vi.fn(async ({ body }: UploadInput) => ({ id: `upload-${body.file.name}` })),
  commitAgent: vi.fn(async ({ body }: CommitInput) => ({
    file: {
      name: body.upload_file_id.replace('upload-', ''),
      file_id: body.upload_file_id,
      mime_type: 'text/markdown',
      size: 5,
    },
  })),
  commitWorkflow: vi.fn(async ({ body }: CommitInput) => ({
    file: {
      name: body.upload_file_id.replace('upload-', ''),
      file_id: body.upload_file_id,
      mime_type: 'text/markdown',
      size: 5,
    },
  })),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'files.upload.post': mocks.upload,
      'agent.byAgentId.config.files.post': mocks.commitAgent,
      'apps.byAppId.agent.config.files.post': mocks.commitWorkflow,
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
}: {
  apiContext?: AgentConfigApiContext
  documentSizeLimit?: number
} = {}) {
  const onUploaded = vi.fn()
  const onOpenChange = vi.fn()
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture({ file_size_limit: documentSizeLimit }),
  )

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
    mocks.upload.mockReset()
    mocks.commitAgent.mockReset()
    mocks.commitWorkflow.mockReset()
    mocks.upload.mockImplementation(async ({ body }) => ({ id: `upload-${body.file.name}` }))
    const commit = async ({ body }: CommitInput) => ({
      file: {
        name: body.upload_file_id.replace('upload-', ''),
        file_id: body.upload_file_id,
        mime_type: 'text/markdown',
        size: 5,
      },
    })
    mocks.commitAgent.mockImplementation(commit)
    mocks.commitWorkflow.mockImplementation(commit)
  })

  it('uploads and binds each selected file before starting the next, and protects the running batch from dismissal or duplicate submission', async () => {
    const user = userEvent.setup()
    const firstUpload = deferred<{ id: string }>()
    const firstCommit = deferred<Awaited<ReturnType<typeof mocks.commitAgent>>>()
    mocks.upload.mockImplementationOnce(() => firstUpload.promise)
    mocks.commitAgent.mockImplementationOnce(() => firstCommit.promise)
    const { onUploaded, onOpenChange } = renderUploadDialog()

    const first = markdownFile('first.md')
    const second = markdownFile('second.md')
    await user.upload(fileInput(), [first, second])
    expect(screen.getByText('first.md')).toBeInTheDocument()
    expect(screen.getByText('second.md')).toBeInTheDocument()
    await user.click(uploadButton())

    await waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce())
    expect(mocks.upload).toHaveBeenCalledWith({ body: { file: first } })
    expect(mocks.commitAgent).not.toHaveBeenCalled()
    expect(fileInput()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await user.click(uploadButton())
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(mocks.upload).toHaveBeenCalledOnce()

    await act(async () => firstUpload.resolve({ id: 'upload-first.md' }))
    await waitFor(() => expect(mocks.commitAgent).toHaveBeenCalledOnce())
    expect(mocks.commitAgent).toHaveBeenCalledWith({
      params: { agent_id: 'agent-1' },
      query: { draft_type: 'draft', version_id: undefined },
      body: { upload_file_id: 'upload-first.md' },
    })
    expect(mocks.upload).toHaveBeenCalledOnce()
    expect(onUploaded).not.toHaveBeenCalled()

    await act(async () =>
      firstCommit.resolve({
        file: { name: 'first.md', file_id: 'upload-first.md', mime_type: 'text/markdown', size: 5 },
      }),
    )
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(2))
    expect(mocks.upload.mock.calls.map(([input]) => input.body.file.name)).toEqual([
      'first.md',
      'second.md',
    ])
    expect(mocks.commitAgent.mock.calls.map(([input]) => input.body.upload_file_id)).toEqual([
      'upload-first.md',
      'upload-second.md',
    ])
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
    expect(mocks.commitAgent.mock.calls.map(([input]) => input.body.upload_file_id)).toEqual([
      'upload-ready.md',
      'upload-retry.md',
    ])
  })

  it('retries a failed workflow binding with its existing upload and preserves the workflow node context', async () => {
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
    await user.upload(fileInput(), markdownFile('workflow.md'))
    await user.click(uploadButton())
    const retry = await within(fileRow('workflow.md')).findByRole('button', {
      name: 'common.operation.retry',
    })
    expect(onUploaded).not.toHaveBeenCalled()
    await user.click(retry)

    await waitFor(() => expect(onUploaded).toHaveBeenCalledOnce())
    expect(mocks.upload).toHaveBeenCalledOnce()
    expect(mocks.commitAgent).not.toHaveBeenCalled()
    expect(mocks.commitWorkflow).toHaveBeenCalledTimes(2)
    expect(mocks.commitWorkflow).toHaveBeenLastCalledWith({
      params: { app_id: 'workflow-1' },
      query: { draft_type: 'debug_build', version_id: 'build-1', node_id: 'node-1' },
      body: { upload_file_id: 'upload-workflow.md' },
    })
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
    expect(screen.getByText('large.md')).toBeInTheDocument()
  })
})
