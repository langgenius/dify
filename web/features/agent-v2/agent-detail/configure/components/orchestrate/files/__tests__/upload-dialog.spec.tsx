import type { AgentConfigApiContext } from '../../config-context'
import type { consoleClient } from '@/service/console'
import { ORPCError } from '@orpc/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { createDeferred } from '@/test/deferred'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { createTestQueryClient } from '@/test/query-client'
import { AgentFileUploadDialog } from '../upload-dialog'

type UploadInput = Parameters<typeof consoleClient.files.upload.post>[0]
type BindAgentInput = Parameters<typeof consoleClient.agent.byAgentId.config.files.batch.post>[0]
type BindWorkflowInput = Parameters<
  typeof consoleClient.apps.byAppId.agent.config.files.batch.post
>[0]

const bindResponse = ({ body }: { body: { upload_file_ids: string[] } }) => ({
  config_version: { id: 'draft-1', kind: 'draft', writable: true },
  files: body.upload_file_ids.map((id) => ({
    name: id.replace('upload-', ''),
    file_id: id,
    file_kind: 'upload_file',
    mime_type: 'text/markdown',
    size: 5,
  })),
})

const mocks = vi.hoisted(() => ({
  upload: vi.fn<(input: UploadInput) => Promise<{ id: string }>>(),
  bindAgent: vi.fn<(input: BindAgentInput) => Promise<ReturnType<typeof bindResponse>>>(),
  bindWorkflow: vi.fn<(input: BindWorkflowInput) => Promise<ReturnType<typeof bindResponse>>>(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'files.upload.post': (input: UploadInput) => mocks.upload(input),
      'agent.byAgentId.config.files.batch.post': (input: BindAgentInput) => mocks.bindAgent(input),
      'apps.byAppId.agent.config.files.batch.post': (input: BindWorkflowInput) =>
        mocks.bindWorkflow(input),
    }),
  }
})

const uploadKey = 'agentV2.agentDetail.configure.files.upload.'

function renderUploadDialog({
  apiContext = { agentId: 'agent-1', draftType: 'draft' },
  documentSizeLimit = 15,
}: {
  apiContext?: AgentConfigApiContext
  documentSizeLimit?: number
} = {}) {
  const onUploaded = vi.fn()
  const onOpenChange = vi.fn()
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture({ file_size_limit: documentSizeLimit }),
  )

  function Harness() {
    const [open, setOpen] = useState(true)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          reopen
        </button>
        <AgentFileUploadDialog
          apiContext={apiContext}
          open={open}
          onOpenChange={(nextOpen) => {
            onOpenChange(nextOpen)
            setOpen(nextOpen)
          }}
          onUploaded={onUploaded}
        />
      </>
    )
  }

  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  )
  return { onUploaded, onOpenChange }
}

function fileName(file: Blob) {
  return file instanceof File ? file.name : ''
}

function markdownFile(name: string) {
  return new File(['hello'], name, { type: 'text/markdown' })
}

function fileRow(name: string) {
  const row = screen.getAllByRole('listitem').find((item) => within(item).queryByText(name))
  if (!row) throw new Error(`No pending file row for ${name}`)
  return row
}

function uploadButton() {
  return screen.getByRole('button', { name: `${uploadKey}action` })
}

function dropFiles(files: File[]) {
  fireEvent.drop(screen.getByRole('group', { name: `${uploadKey}title` }), {
    dataTransfer: { types: ['Files'], files },
  })
}

function uploadedNames() {
  return mocks.upload.mock.calls.map(([input]) => fileName(input.body.file))
}

describe('AgentFileUploadDialog', () => {
  beforeEach(() => {
    mocks.upload.mockImplementation(async ({ body }) => ({ id: `upload-${fileName(body.file)}` }))
    mocks.bindAgent.mockImplementation(async (input) => bindResponse(input))
    mocks.bindWorkflow.mockImplementation(async (input) => bindResponse(input))
  })

  it('keeps the dialog open while files upload', async () => {
    const user = userEvent.setup()
    const upload = createDeferred<{ id: string }>()
    mocks.upload.mockReturnValueOnce(upload.promise)
    const { onOpenChange } = renderUploadDialog()

    dropFiles([markdownFile('first.md')])
    await user.click(uploadButton())
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce())

    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: `${uploadKey}browse` })).toBeDisabled()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(onOpenChange).not.toHaveBeenCalled()

    await act(async () => upload.resolve({ id: 'upload-first.md' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false))
  })

  it('uploads every file before binding them in one request and reports the bound files', async () => {
    const user = userEvent.setup()
    const firstUpload = createDeferred<{ id: string }>()
    mocks.upload.mockReturnValueOnce(firstUpload.promise)
    const { onUploaded, onOpenChange } = renderUploadDialog()

    dropFiles([markdownFile('first.md'), markdownFile('second.md')])
    await user.click(uploadButton())
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2))
    expect(mocks.bindAgent).not.toHaveBeenCalled()

    await act(async () => firstUpload.resolve({ id: 'upload-first.md' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false))
    expect(mocks.bindAgent).toHaveBeenCalledExactlyOnceWith({
      params: { agent_id: 'agent-1' },
      query: { draft_type: 'draft', version_id: undefined },
      body: { upload_file_ids: ['upload-first.md', 'upload-second.md'] },
    })
    expect(onUploaded).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ name: 'first.md', fileId: 'upload-first.md' }),
      expect.objectContaining({ name: 'second.md', fileId: 'upload-second.md' }),
    ])
  })

  it('binds the files that uploaded, shows why the other failed and retries only that one', async () => {
    const user = userEvent.setup()
    mocks.upload.mockRejectedValueOnce(
      new ORPCError('file_extension_blocked', { status: 400, message: 'File type not allowed' }),
    )
    const { onUploaded, onOpenChange } = renderUploadDialog()

    dropFiles([markdownFile('retry.md'), markdownFile('ready.md')])
    await user.click(uploadButton())

    expect(
      await within(fileRow('retry.md')).findByText('File type not allowed'),
    ).toBeInTheDocument()
    expect(screen.queryByText('ready.md')).not.toBeInTheDocument()
    expect(onUploaded).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ name: 'ready.md' }),
    ])
    expect(onOpenChange).not.toHaveBeenCalled()

    await user.click(uploadButton())

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false))
    expect(uploadedNames()).toEqual(['retry.md', 'ready.md', 'retry.md'])
    expect(mocks.bindAgent.mock.calls.map(([input]) => input.body.upload_file_ids)).toEqual([
      ['upload-ready.md'],
      ['upload-retry.md'],
    ])
  })

  it('does not bind anything when every upload fails', async () => {
    const user = userEvent.setup()
    mocks.upload.mockRejectedValue(new TypeError('Failed to fetch'))
    const { onUploaded, onOpenChange } = renderUploadDialog()

    dropFiles([markdownFile('first.md'), markdownFile('second.md')])
    await user.click(uploadButton())

    expect(await within(fileRow('first.md')).findByText(`${uploadKey}failed`)).toBeInTheDocument()
    expect(within(fileRow('second.md')).getByText(`${uploadKey}failed`)).toBeInTheDocument()
    expect(mocks.bindAgent).not.toHaveBeenCalled()
    expect(onUploaded).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('marks every file failed when the workflow binding fails and uploads them again on retry', async () => {
    const user = userEvent.setup()
    mocks.bindWorkflow.mockRejectedValueOnce(new Error('Binding failed'))
    const { onUploaded, onOpenChange } = renderUploadDialog({
      apiContext: {
        agentId: 'agent-1',
        draftType: 'debug_build',
        versionId: 'build-1',
        workflow: { appId: 'workflow-1', nodeId: 'node-1' },
      },
    })

    dropFiles([markdownFile('first.md'), markdownFile('second.md')])
    await user.click(uploadButton())

    expect(await within(fileRow('first.md')).findByText(`${uploadKey}failed`)).toBeInTheDocument()
    expect(within(fileRow('second.md')).getByText(`${uploadKey}failed`)).toBeInTheDocument()
    expect(onUploaded).not.toHaveBeenCalled()

    await user.click(uploadButton())

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false))
    expect(uploadedNames()).toHaveLength(4)
    expect(mocks.bindAgent).not.toHaveBeenCalled()
    expect(mocks.bindWorkflow).toHaveBeenLastCalledWith({
      params: { app_id: 'workflow-1' },
      query: { node_id: 'node-1', draft_type: 'debug_build', version_id: 'build-1' },
      body: { upload_file_ids: ['upload-first.md', 'upload-second.md'] },
    })
  })

  it('blocks uploading while a file exceeds its size limit until that file is removed', async () => {
    const user = userEvent.setup()
    const { onUploaded } = renderUploadDialog({ documentSizeLimit: 1 })
    const oversized = new File([new Uint8Array(1024 * 1024 + 1)], 'large.md', {
      type: 'text/markdown',
    })

    dropFiles([markdownFile('small.md'), oversized])

    expect(
      within(fileRow('large.md')).getByText(/common\.fileUploader\.uploadFromComputerLimit/),
    ).toHaveTextContent('1.00 MB')
    expect(uploadButton()).toBeDisabled()

    await user.click(
      within(fileRow('large.md')).getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.files\.remove/,
      }),
    )
    await user.click(uploadButton())

    await waitFor(() => expect(onUploaded).toHaveBeenCalledOnce())
    expect(uploadedNames()).toEqual(['small.md'])
  })

  it('starts empty after the dialog is closed and reopened', async () => {
    const user = userEvent.setup()
    mocks.upload.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderUploadDialog()

    dropFiles([markdownFile('failed.md')])
    await user.click(uploadButton())
    await within(fileRow('failed.md')).findByText(`${uploadKey}failed`)
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'reopen' }))

    expect(await screen.findByRole('dialog')).toBeVisible()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
    expect(uploadButton()).toBeDisabled()
  })
})
