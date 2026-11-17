import type { UpdateAppPayload } from '@dify/contracts/api/console/apps/types.gen'
import type { ComponentProps } from 'react'
import type { Mock } from 'vite-plus/test'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useMutation } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { mockEmojiData } from '@/test/emoji-picker'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { AppMetadataForm } from '../index'

vi.mock('@/next/navigation', () => ({ useParams: () => ({}) }))

const app: ComponentProps<typeof AppMetadataForm>['appDetail'] = {
  name: 'Test App',
  description: 'Test description',
  icon_type: 'emoji',
  icon: '🤖',
  icon_background: '#FFEAD5',
  icon_url: null,
}
function setup({
  source = app,
  onConfirm = vi.fn<(body: UpdateAppPayload) => Promise<void>>().mockResolvedValue(undefined),
  cloud = false,
  quota = { size: 1, limit: 10 },
}: {
  source?: ComponentProps<typeof AppMetadataForm>['appDetail']
  onConfirm?: Mock<(body: UpdateAppPayload) => Promise<void>>
  cloud?: boolean
  quota?: { size: number; limit: number }
} = {}) {
  function Entry() {
    const [open, setOpen] = useState(true)
    const submission = useMutation({ mutationFn: (body: UpdateAppPayload) => onConfirm(body) })
    const nameInputRef = useRef<HTMLInputElement>(null)
    return (
      <>
        <button onClick={() => setOpen(true)}>Reopen</button>
        <Dialog
          open={open}
          onOpenChangeComplete={(open) => {
            if (!open && !submission.isPending) submission.reset()
          }}
          onOpenChange={(nextOpen, details) => {
            if (!nextOpen && submission.isPending) details.cancel()
            else setOpen(nextOpen)
          }}
        >
          <DialogContent initialFocus={nameInputRef}>
            <AppMetadataForm
              operation="create"
              appDetail={source}
              nameInputRef={nameInputRef}
              isPending={submission.isPending}
              error={submission.error?.message}
              onSubmit={(body) => {
                if (!submission.isPending) submission.mutate(body)
              }}
            />
          </DialogContent>
        </Dialog>
      </>
    )
  }
  const { wrapper: UrlState } = createNuqsTestWrapper()
  renderWithConsoleQuery(
    <UrlState>
      <Entry />
    </UrlState>,
    {
      systemFeatures: { deployment_edition: cloud ? 'CLOUD' : 'COMMUNITY' },
      features: { apps: quota },
    },
  )
  return { onConfirm }
}

it('submits current name, description and icon through the form', async () => {
  const user = userEvent.setup()
  const { onConfirm } = setup()
  const name = await screen.findByRole('textbox', { name: 'app.newApp.name' })
  await user.clear(name)
  await user.type(name, 'Created app')
  const description = screen.getByRole('textbox', { name: 'app.newApp.captionDescription' })
  await user.clear(description)
  await user.type(description, 'Updated description')
  await user.click(screen.getByRole('button', { name: /common.operation.create/ }))
  await waitFor(() =>
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
      name: 'Created app',
      description: 'Updated description',
      icon_type: 'emoji',
      icon: '🤖',
      icon_background: '#FFEAD5',
    }),
  )
})

it('keeps failed drafts, blocks repeated submission and pending dismissal, and allows retry', async () => {
  const user = userEvent.setup()
  let rejectRequest: (error: Error) => void = () => {}
  const onConfirm = vi.fn<(body: UpdateAppPayload) => Promise<void>>().mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectRequest = reject
      }),
  )
  setup({ onConfirm })
  const name = await screen.findByRole('textbox', { name: 'app.newApp.name' })
  await user.clear(name)
  await user.type(name, 'Retry draft{Enter}')
  await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
  expect(name).toHaveAttribute('readonly')
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: /common.operation.create/ }))
  expect(onConfirm).toHaveBeenCalledOnce()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await act(async () => rejectRequest(new Error('Import unavailable')))
  expect(await screen.findByRole('alert')).toHaveTextContent('Import unavailable')
  expect(name).toHaveValue('Retry draft')
  onConfirm.mockResolvedValueOnce(undefined)
  await user.click(screen.getByRole('button', { name: /common.operation.create/ }))
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2))
})

it('resets cancelled drafts and errors when the persistent dialog reopens', async () => {
  const user = userEvent.setup()
  setup({
    onConfirm: vi
      .fn<(body: UpdateAppPayload) => Promise<void>>()
      .mockRejectedValue(new Error('Failed')),
  })
  const name = await screen.findByRole('textbox', { name: 'app.newApp.name' })
  await user.clear(name)
  await user.type(name, 'Discarded{Enter}')
  await screen.findByRole('alert')
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: 'Reopen' }))
  expect(await screen.findByRole('textbox', { name: 'app.newApp.name' })).toHaveValue(app.name)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it.each(['', '   '])('prevents submission of a blank name: %j', async (name) => {
  const user = userEvent.setup()
  const { onConfirm } = setup({ source: { ...app, name } })
  await user.click(await screen.findByRole('button', { name: /common.operation.create/ }))
  expect(onConfirm).not.toHaveBeenCalled()
})

it.each([
  { icon_type: null, icon: null, icon_background: null },
  { icon_type: 'link' as const, icon: 'https://example.com/icon.png', icon_background: null },
  { icon_type: 'image' as const, icon: 'file-id', icon_background: null },
])('preserves an unchanged icon and nullable background: %j', async (icon) => {
  const user = userEvent.setup()
  const { onConfirm } = setup({ source: { ...app, ...icon } })
  await user.click(await screen.findByRole('button', { name: /common.operation.create/ }))
  await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining(icon)))
})

it.each([
  { platform: 'Win32', modifier: { ctrlKey: true } },
  { platform: 'MacIntel', modifier: { metaKey: true } },
])(
  'excludes nested picker submission, IME and repeats from Mod+Enter on $platform',
  async ({ platform, modifier }) => {
    const user = userEvent.setup()
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
    const { onConfirm } = setup()
    await user.click(await screen.findByRole('button', { name: 'app.iconPicker.title' }))
    const picker = await screen.findByRole('dialog', { name: 'app.iconPicker.title' })
    fireEvent.keyDown(within(picker).getByPlaceholderText('app.iconPicker.search'), {
      key: 'Enter',
      ...modifier,
    })
    expect(onConfirm).not.toHaveBeenCalled()
    await user.click(within(picker).getByRole('radio', { name: 'app.iconPicker.color.green' }))
    await user.click(within(picker).getByRole('button', { name: 'app.iconPicker.ok' }))
    expect(onConfirm).not.toHaveBeenCalled()
    const name = screen.getByRole('textbox', { name: 'app.newApp.name' })
    fireEvent.keyDown(name, { key: 'Enter', ...modifier, isComposing: true })
    fireEvent.keyDown(name, { key: 'Enter', ...modifier, repeat: true })
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.keyDown(name, { key: 'Enter', ...modifier })
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ icon_background: '#F3FEE7' }))
  },
)

it.each([
  { cloud: true, quota: { size: 10, limit: 10 }, disabled: true },
  { cloud: true, quota: { size: 10, limit: 0 }, disabled: false },
  { cloud: false, quota: { size: 10, limit: 10 }, disabled: false },
])(
  'applies cloud creation quota without treating zero as a limit: %j',
  async ({ cloud, quota, disabled }) => {
    setup({ cloud, quota })
    const create = await screen.findByRole('button', { name: /common.operation.create/ })
    if (disabled) expect(create).toBeDisabled()
    else expect(create).toBeEnabled()
  },
)

mockEmojiData()
