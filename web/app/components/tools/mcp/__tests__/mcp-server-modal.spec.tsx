import type { ComponentProps } from 'react'
import type { MCPServerDetail } from '@/app/components/tools/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MCPServerModal } from '../mcp-server-modal'

const { post, put } = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn() }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  post,
  put,
}))

const detail: MCPServerDetail = {
  id: 'server-1',
  server_code: 'server-code',
  status: 'active',
  description: 'Server description',
  parameters: { question: 'Existing question', removed: 'No longer exposed' },
}
const latestParams = [{ variable: 'question', label: 'Question', type: 'string' }]

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete
    reject = fail
  })
  return { promise, resolve, reject }
}

function setup(overrides: Partial<ComponentProps<typeof MCPServerModal>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const props: ComponentProps<typeof MCPServerModal> = {
    appID: 'app-123',
    open: true,
    onOpenChange: vi.fn(),
    latestParams,
    ...overrides,
  }
  const renderModal = (nextProps = props) => (
    <QueryClientProvider client={queryClient}>
      <MCPServerModal {...nextProps} />
    </QueryClientProvider>
  )
  const result = render(renderModal())
  return {
    ...result,
    props,
    queryClient,
    rerenderModal: (nextProps: typeof props) => result.rerender(renderModal(nextProps)),
  }
}

beforeEach(() => {
  post.mockReset().mockResolvedValue({ result: 'success' })
  put.mockReset().mockResolvedValue({ result: 'success' })
})

it('uses the app description for creation and keeps Enter as multiline input rather than submit', async () => {
  const user = userEvent.setup()
  setup({ appInfo: { description: 'App description' } })
  const dialog = screen.getByRole('dialog', { name: 'tools.mcp.server.modal.addTitle' })
  const description = within(dialog).getByRole('textbox', {
    name: 'tools.mcp.server.modal.description',
  })
  expect(description).toHaveValue('App description')
  await user.clear(description)
  expect(
    within(dialog).getByRole('button', { name: 'tools.mcp.server.modal.confirm' }),
  ).toBeDisabled()
  await user.type(description, 'First line{Enter}Second line')
  await user.type(within(dialog).getByRole('textbox', { name: 'Question' }), 'First{Enter}Second')
  expect(description).toHaveValue('First line\nSecond line')
  expect(within(dialog).getByRole('textbox', { name: 'Question' })).toHaveValue('First\nSecond')
  expect(post).not.toHaveBeenCalled()
})

it('preserves create whitespace omission while filtering undefined or missing variables', async () => {
  const user = userEvent.setup()
  const { props } = setup({
    latestParams: [
      ...latestParams,
      { variable: 'untouched', label: 'Untouched' },
      { label: 'No variable' },
    ],
  })
  await user.type(
    screen.getByRole('textbox', { name: 'tools.mcp.server.modal.description' }),
    '   ',
  )
  await user.type(screen.getByRole('textbox', { name: 'Question' }), 'temporary')
  await user.clear(screen.getByRole('textbox', { name: 'Question' }))
  await user.click(screen.getByRole('button', { name: 'tools.mcp.server.modal.confirm' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('apps/app-123/server', {
      body: { parameters: { question: '' } },
    }),
  )
  expect(screen.queryByRole('textbox', { name: 'No variable' })).not.toBeInTheDocument()
  await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(false))
})

it('preserves update whitespace and filters removed parameters without changing the server identity', async () => {
  const user = userEvent.setup()
  const { props } = setup({ data: detail, appInfo: { description: 'Fallback' } })
  expect(
    screen.getByRole('dialog', { name: 'tools.mcp.server.modal.editTitle' }),
  ).toBeInTheDocument()
  const description = screen.getByRole('textbox', { name: 'tools.mcp.server.modal.description' })
  expect(description).toHaveValue(detail.description)
  await user.clear(description)
  await user.type(description, '   ')
  await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.save' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('apps/app-123/server', {
      body: { id: detail.id, description: '   ', parameters: { question: 'Existing question' } },
    }),
  )
  expect(post).not.toHaveBeenCalled()
  await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(false))
})

it.each(['create', 'update'] as const)(
  'locks a pending %s session and preserves both drafts for retry after rejection',
  async (mode) => {
    const user = userEvent.setup()
    const first = deferred<unknown>()
    const retry = deferred<unknown>()
    const mutation = mode === 'create' ? post : put
    mutation.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise)
    const { props } = setup({ data: mode === 'update' ? detail : undefined })
    const dialog = screen.getByRole('dialog')
    const description = within(dialog).getByRole('textbox', {
      name: 'tools.mcp.server.modal.description',
    })
    const parameter = within(dialog).getByRole('textbox', { name: 'Question' })
    await user.clear(description)
    await user.type(description, 'Retry description')
    await user.clear(parameter)
    await user.type(parameter, 'Retry parameter')
    const submit = within(dialog).getByRole('button', {
      name: mode === 'create' ? 'tools.mcp.server.modal.confirm' : 'tools.mcp.modal.save',
    })
    await user.click(submit)
    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(1))
    expect(submit).toHaveFocus()
    expect(description).toHaveAttribute('readonly')
    expect(parameter).toHaveAttribute('readonly')
    expect(within(dialog).getByRole('button', { name: 'tools.mcp.modal.cancel' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'common.operation.close' })).toBeDisabled()
    await user.keyboard('{Enter}{Escape}')
    expect(mutation).toHaveBeenCalledTimes(1)
    expect(props.onOpenChange).not.toHaveBeenCalled()
    await act(async () => first.reject(new Error('Request failed')))
    await waitFor(() => expect(description).not.toHaveAttribute('readonly'))
    expect(description).toHaveValue('Retry description')
    expect(parameter).toHaveValue('Retry parameter')
    expect(props.onOpenChange).not.toHaveBeenCalled()
    await user.click(submit)
    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(2))
    expect(mutation.mock.calls[1]).toEqual(mutation.mock.calls[0])
    await act(async () => retry.resolve({ result: 'success' }))
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(false))
  },
)

it('discards a cancelled session and reads fresh source values on reopening the same owner', async () => {
  const user = userEvent.setup()
  const { props, rerenderModal } = setup({ data: detail })
  const input = screen.getByRole('textbox', { name: 'tools.mcp.server.modal.description' })
  await user.clear(input)
  await user.type(input, 'Discard this')
  await user.click(screen.getByRole('button', { name: 'tools.mcp.modal.cancel' }))
  expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  rerenderModal({ ...props, open: false })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  rerenderModal({
    ...props,
    data: {
      ...detail,
      description: 'Latest description',
      parameters: { question: 'Latest parameter' },
    },
  })
  expect(
    await screen.findByRole('textbox', { name: 'tools.mcp.server.modal.description' }),
  ).toHaveValue('Latest description')
  expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('Latest parameter')
  expect(post).not.toHaveBeenCalled()
  expect(put).not.toHaveBeenCalled()
})

it('notifies an idle dismissal from Close or Escape without submitting', async () => {
  const user = userEvent.setup()
  const { props } = setup()
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(props.onOpenChange).toHaveBeenCalledWith(false)
  await user.keyboard('{Escape}')
  expect(props.onOpenChange).toHaveBeenCalledTimes(2)
  expect(post).not.toHaveBeenCalled()
})
