import type { WorkflowToolProviderResponse } from '@/app/components/tools/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { WorkflowToolDrawer } from '../../index'
import { useConfigureButton } from '../use-configure-button'

const { get, post, success, error } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@/service/base', () => ({
  get,
  post,
  put: vi.fn(),
  del: vi.fn(),
  patch: vi.fn(),
}))
vi.mock('@/app/notifications', () => ({ toast: { success, error } }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const detail: WorkflowToolProviderResponse = {
  workflow_app_id: 'app-1',
  workflow_tool_id: 'tool-1',
  name: 'existing_tool',
  label: 'Existing Tool',
  description: 'Original description',
  icon: { content: '🔧', background: '#ffffff' },
  synced: true,
  tool: {
    author: 'Dify',
    name: 'existing_tool',
    label: { en_US: 'Existing Tool', zh_Hans: 'Existing Tool' },
    description: { en_US: 'Original description', zh_Hans: 'Original description' },
    labels: [],
    parameters: [],
    output_schema: { type: 'object', properties: {} },
  },
  privacy_policy: '',
}

function ConfiguredTool({
  publish,
  onRefresh,
}: {
  publish: () => Promise<void>
  onRefresh: () => void
}) {
  const [open, setOpen] = useState(true)
  const configuration = useConfigureButton({
    enabled: true,
    published: true,
    detailNeedUpdate: false,
    workflowAppId: 'app-1',
    icon: detail.icon,
    name: 'Workflow',
    description: '',
    inputs: [],
    outputs: [],
    handlePublish: publish,
    onRefreshData: onRefresh,
    onConfigured: () => setOpen(false),
  })
  return open && !configuration.isLoading ? (
    <WorkflowToolDrawer
      payload={configuration.payload}
      onHide={() => setOpen(false)}
      onSave={configuration.handleUpdate}
    />
  ) : null
}

it('keeps the real confirmation and draft after save failure, and closes on POST success without waiting for refresh', async () => {
  const user = userEvent.setup()
  const publishing = deferred<void>()
  const saving = deferred<object>()
  const refresh = deferred<WorkflowToolProviderResponse>()
  const publish = vi.fn().mockReturnValueOnce(publishing.promise).mockResolvedValue(undefined)
  const onRefresh = vi.fn()
  post.mockReturnValueOnce(saving.promise).mockResolvedValueOnce({ result: 'success' })
  get.mockResolvedValueOnce(detail).mockReturnValue(refresh.promise)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  render(
    <QueryClientProvider client={client}>
      <ConfiguredTool publish={publish} onRefresh={onRefresh} />
    </QueryClientProvider>,
  )
  const label = await screen.findByPlaceholderText('tools.createTool.toolNamePlaceHolder')
  await user.clear(label)
  await user.type(label, 'Edited label')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  const confirmation = screen.getByRole('dialog', { name: 'tools.createTool.confirmTitle' })
  await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
  expect(publish).toHaveBeenCalledOnce()
  expect(post).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'common.operation.confirm' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeEnabled()
  await act(async () => publishing.resolve())
  await waitFor(() =>
    expect(post).toHaveBeenCalledExactlyOnceWith(
      '/workspaces/current/tool-provider/workflow/update',
      {
        body: expect.objectContaining({
          label: 'Edited label',
          name: 'existing_tool',
          workflow_tool_id: 'tool-1',
        }),
      },
    ),
  )
  expect(confirmation).toBeInTheDocument()
  await act(async () => saving.reject(new Error('Save failed')))
  expect(error).toHaveBeenCalledWith('Save failed')
  expect(confirmation).toBeInTheDocument()
  expect(onRefresh).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(confirmation).not.toBeInTheDocument())
  expect(label).toHaveValue('Edited label')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(post).toHaveBeenCalledTimes(2)
  expect(publish).toHaveBeenCalledTimes(2)
  expect(onRefresh).toHaveBeenCalledOnce()
  expect(success).toHaveBeenCalledWith('common.api.actionSuccess')
  expect(get).toHaveBeenLastCalledWith(
    '/workspaces/current/tool-provider/workflow/get?workflow_app_id=app-1',
  )
  expect(get).toHaveBeenCalledTimes(2)
  await act(async () => refresh.resolve(detail))
  client.clear()
})
