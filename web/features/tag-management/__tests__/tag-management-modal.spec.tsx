import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TagManagementModal } from '../components/tag-management-modal'
import { renderWithTags } from './render'

const { request, notify, permissions } = vi.hoisted(() => ({
  request: vi.fn(),
  notify: { success: vi.fn(), error: vi.fn() },
  permissions: { value: ['app.tag.manage', 'dataset.tag.manage', 'snippets.create_and_modify'] },
}))

vi.mock('@/service/base', () => ({ request: (...args: unknown[]) => request(...args) }))
vi.mock('@/app/notifications', () => ({ toast: notify }))
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({ workspacePermissionKeys: permissions.value }))
})

const tags: Tag[] = [
  { id: 'tag-1', name: 'Frontend', type: 'app', binding_count: '' },
  { id: 'tag-2', name: 'Backend', type: 'app', binding_count: '' },
]
const renderModal = (overrides: Partial<React.ComponentProps<typeof TagManagementModal>> = {}) => {
  const props = { type: 'app' as const, show: true, onClose: vi.fn(), ...overrides }
  return { ...renderWithTags(<TagManagementModal {...props} />, tags), props }
}
const inputName = 'common.tag.addNew'

beforeEach(() => {
  vi.clearAllMocks()
  request
    .mockReset()
    .mockResolvedValue(
      Response.json({ id: 'new-tag', name: 'NewTag', type: 'app', binding_count: '' }),
    )
  permissions.value = ['app.tag.manage', 'dataset.tag.manage', 'snippets.create_and_modify']
})

it('names the dialog and shows existing tags', () => {
  renderModal()
  expect(screen.getByRole('dialog', { name: 'common.tag.manageTags' })).toBeInTheDocument()
  expect(screen.getByText('Frontend')).toBeInTheDocument()
  expect(screen.getByText('Backend')).toBeInTheDocument()
})

it.each(['app', 'knowledge', 'snippet'] as const)(
  'creates a %s tag and clears the successful draft',
  async (type) => {
    const user = userEvent.setup()
    renderModal({ type })
    const input = screen.getByRole('textbox', { name: inputName })
    await user.type(input, 'NewTag{Enter}')

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    const submitted = request.mock.calls[0]?.[2]?.request as Request
    expect(submitted.method).toBe('POST')
    expect(new URL(submitted.url).pathname).toMatch(/\/tags$/)
    expect(await submitted.json()).toEqual({ name: 'NewTag', type })
    await waitFor(() => expect(input).toHaveValue(''))
    expect(notify.success).toHaveBeenCalledWith('common.tag.created')
  },
)

it('submits on blur and prevents duplicate submission or draft edits while pending', async () => {
  const user = userEvent.setup()
  let resolveRequest: (value: Response) => void = () => {}
  request.mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      resolveRequest = resolve
    }),
  )
  renderModal()
  const input = screen.getByRole('textbox', { name: inputName })
  await user.type(input, 'Pending')
  await user.tab()
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  expect(input).toHaveAttribute('readonly')
  await user.type(input, 'changed{Enter}')
  await user.tab()
  expect(request).toHaveBeenCalledTimes(1)
  expect(input).toHaveValue('Pending')

  await act(async () =>
    resolveRequest(Response.json({ id: 'new', name: 'Pending', type: 'app', binding_count: '' })),
  )
  await waitFor(() => expect(input).toHaveValue(''))
  expect(input).not.toHaveAttribute('readonly')
})

it('keeps a failed draft available for correction and retry', async () => {
  const user = userEvent.setup()
  request.mockRejectedValueOnce(new Error('Creation failed'))
  renderModal()
  const input = screen.getByRole('textbox', { name: inputName })
  await user.type(input, 'FailTag{Enter}')
  await waitFor(() => expect(notify.error).toHaveBeenCalledWith('common.tag.failed'))
  expect(input).toHaveValue('FailTag')
  expect(input).not.toHaveAttribute('readonly')
  await user.keyboard('{Enter}')
  await waitFor(() => expect(input).toHaveValue(''))
  expect(request).toHaveBeenCalledTimes(2)
})

it('does not submit an empty name', async () => {
  const user = userEvent.setup()
  renderModal()
  await user.click(screen.getByRole('textbox', { name: inputName }))
  await user.keyboard('{Enter}')
  await user.tab()
  expect(request).not.toHaveBeenCalled()
})

it.each(['button', 'Escape'])('closes with %s', async (method) => {
  const user = userEvent.setup()
  const { props } = renderModal()
  if (method === 'button')
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  else await user.keyboard('{Escape}')
  expect(props.onClose).toHaveBeenCalledTimes(1)
})

it('hides management controls without permission', () => {
  permissions.value = []
  renderModal()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(request).not.toHaveBeenCalled()
})
