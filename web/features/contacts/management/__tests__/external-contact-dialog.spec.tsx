import type { ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createDeferred } from '@/test/deferred'
import { ExternalContactDialog } from '../external-contact-dialog'
import { alice } from './fixtures/data'

const api = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), upload: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.humanInput.v2.contacts.external.post': api.create,
      'workspaces.current.humanInput.v2.contacts.external.byContactId.patch': api.update,
      'files.upload.post': api.upload,
    }),
  }
})

function setup(contact?: ComponentProps<typeof ExternalContactDialog>['contact']) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const onCreated = vi.fn()
  function Host() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open contact
        </button>
        <ExternalContactDialog
          open={open}
          onOpenChange={setOpen}
          contact={contact}
          onCreated={onCreated}
        />
      </>
    )
  }
  render(
    <QueryClientProvider client={queryClient}>
      <Host />
    </QueryClientProvider>,
  )
  return { onCreated, queryClient }
}
async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open contact' }))
  return screen.findByRole('dialog')
}
async function fill(
  user: ReturnType<typeof userEvent.setup>,
  name = 'Alice',
  email = 'alice@example.com',
) {
  await user.type(screen.getByRole('textbox', { name: 'contacts.external.name' }), name)
  await user.type(screen.getByRole('textbox', { name: 'contacts.external.email' }), email)
}
beforeEach(() => {
  api.create.mockReset().mockResolvedValue({ contact: alice })
  api.update.mockReset().mockResolvedValue({ contact: alice })
  api.upload.mockReset().mockResolvedValue({ id: 'avatar-file' })
})

it('validates required fields and malformed email before calling the generated mutation', async () => {
  const user = userEvent.setup()
  setup()
  await open(user)
  await user.click(screen.getByRole('button', { name: 'contacts.external.add' }))
  expect(await screen.findByText('contacts.external.validation.name_required')).toBeInTheDocument()
  expect(api.create).not.toHaveBeenCalled()
  await fill(user, 'Alice', 'john..doe@example.com')
  await user.click(screen.getByRole('button', { name: 'contacts.external.add' }))
  expect(await screen.findByText('contacts.external.validation.email_invalid')).toBeInTheDocument()
  expect(api.create).not.toHaveBeenCalled()
})

it.each(['john<doe>@example.com', 'john@example..com'])(
  'preserves browser email validation for %s through the Field owner',
  async (email) => {
    const user = userEvent.setup()
    setup()
    await open(user)
    await fill(user, 'Alice', email)
    await user.click(screen.getByRole('button', { name: 'contacts.external.add' }))
    expect(
      await screen.findByText('contacts.external.validation.email_invalid'),
    ).toBeInTheDocument()
    expect(api.create).not.toHaveBeenCalled()
  },
)

it('uses one field error for the duplicate-email 409 and keeps the draft for correction', async () => {
  const user = userEvent.setup()
  api.create.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { status: 409 }))
  setup()
  await open(user)
  await fill(user)
  await user.click(screen.getByRole('button', { name: 'contacts.external.add' }))
  const duplicate = await screen.findByText('contacts.external.result.duplicate_external_contact')
  const email = screen.getByRole('textbox', { name: 'contacts.external.email' })
  expect(email).toHaveAttribute('aria-invalid', 'true')
  expect(email).toHaveAccessibleDescription('contacts.external.result.duplicate_external_contact')
  expect(screen.getAllByText(duplicate.textContent!)).toHaveLength(1)
  expect(email).toHaveValue('alice@example.com')
  await user.clear(email)
  await user.type(email, 'corrected@example.com')
  await user.click(screen.getByRole('button', { name: 'contacts.external.add' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.create).toHaveBeenLastCalledWith({
    body: { name: 'Alice', email: 'corrected@example.com' },
  })
})

it('prevents repeated submission and dismissal while pending, then closes on success', async () => {
  const user = userEvent.setup()
  const request = createDeferred<{ contact: typeof alice }>()
  api.create.mockReturnValueOnce(request.promise)
  const { onCreated } = setup()
  await open(user)
  await fill(user)
  const submit = screen.getByRole('button', { name: 'contacts.external.add' })
  await user.click(submit)
  await user.click(submit)
  await user.keyboard('{Escape}')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(api.create).toHaveBeenCalledOnce()
  await act(async () => request.resolve({ contact: alice }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(onCreated).toHaveBeenCalledWith(alice.id)
})

it('retains the draft through a failed save and starts a new form only after close', async () => {
  const user = userEvent.setup()
  api.create.mockRejectedValueOnce(new Error('Service unavailable'))
  setup()
  await open(user)
  await fill(user)
  await user.click(screen.getByRole('button', { name: 'contacts.external.add' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('contacts.external.result.failed')
  expect(screen.getByRole('textbox', { name: 'contacts.external.name' })).toHaveValue('Alice')
  await user.click(screen.getByRole('button', { name: 'contacts.action.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await open(user)
  expect(screen.getByRole('textbox', { name: 'contacts.external.name' })).toHaveValue('')
  expect(screen.getByRole('textbox', { name: 'contacts.external.email' })).toHaveValue('')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('edits through the generated PATCH and preserves an intentional empty name as a validation failure', async () => {
  const user = userEvent.setup()
  setup(alice)
  await open(user)
  const name = screen.getByRole('textbox', { name: 'contacts.external.name' })
  await user.clear(name)
  await user.click(screen.getByRole('button', { name: 'contacts.external.save' }))
  expect(api.update).not.toHaveBeenCalled()
  await user.type(name, 'Alice Updated')
  await user.click(screen.getByRole('button', { name: 'contacts.external.save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.update).toHaveBeenCalledWith({
    params: { contact_id: alice.id },
    body: { name: 'Alice Updated', email: alice.email },
  })
})

it.each(['create', 'edit'] as const)(
  'rejects an overlong name before %s and allows correcting the Unicode boundary',
  async (mode) => {
    const user = userEvent.setup()
    setup(mode === 'edit' ? alice : undefined)
    await open(user)
    const name = screen.getByRole('textbox', { name: 'contacts.external.name' })
    const save = screen.getByRole('button', {
      name: `contacts.external.${mode === 'edit' ? 'save' : 'add'}`,
    })
    if (mode === 'create')
      await user.type(
        screen.getByRole('textbox', { name: 'contacts.external.email' }),
        alice.email!,
      )
    await user.clear(name)
    await user.click(name)
    await user.paste('中'.repeat(256))
    await user.click(save)

    await waitFor(() => expect(name).toHaveFocus())
    expect(name).toHaveAccessibleDescription(/contacts\.external\.validation\.name_too_long/)
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(api.create).not.toHaveBeenCalled()
    expect(api.update).not.toHaveBeenCalled()

    const validName = '😀'.repeat(255)
    await user.clear(name)
    await user.click(name)
    await user.paste(`  ${validName}  `)
    await user.click(save)

    const body = { name: validName, email: alice.email }
    await waitFor(() => {
      if (mode === 'create') expect(api.create).toHaveBeenCalledWith({ body })
      else expect(api.update).toHaveBeenCalledWith({ params: { contact_id: alice.id }, body })
    })
  },
)

it('uploads a valid avatar and submits its file ID without exposing the blob URL', async () => {
  const user = userEvent.setup()
  setup()
  const dialog = await open(user)
  await fill(user)
  const upload = within(dialog).getByLabelText('common.imageUploader.imageUpload')
  await user.upload(upload, new File(['image'], 'avatar.png', { type: 'image/png' }))
  await waitFor(() => expect(api.upload).toHaveBeenCalledOnce())
  await user.click(screen.getByRole('button', { name: 'contacts.external.add' }))
  await waitFor(() =>
    expect(api.create).toHaveBeenCalledWith({
      body: { name: 'Alice', email: 'alice@example.com', avatar: 'avatar-file' },
    }),
  )
})

it('keeps invalid avatar files local and blocks submit until reset', async () => {
  const user = userEvent.setup()
  setup()
  await open(user)
  await fill(user)
  const file = new File(['bad'], 'avatar.exe', { type: 'application/octet-stream' })
  fireEvent.change(screen.getByLabelText('common.imageUploader.imageUpload'), {
    target: { files: [file] },
  })
  expect(await screen.findByRole('alert')).toHaveTextContent('common.imageInput.supportedFormats')
  expect(api.upload).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'common.operation.reset' }))
  await user.click(screen.getByRole('button', { name: 'contacts.external.add' }))
  await waitFor(() => expect(api.create).toHaveBeenCalledOnce())
})
