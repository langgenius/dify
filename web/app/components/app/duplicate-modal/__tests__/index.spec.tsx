import type { ReactElement } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { consoleQuery } from '@/service/console'
import { consoleBrowserLink } from '@/service/console/browser'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery,
  seedFeatures,
} from '@/test/console/query-data'
import { mockEmojiData } from '@/test/emoji-picker'
import { DuplicateAppDialog } from '../index'

mockEmojiData()

const { mockAppQuota, toastErrorMock } = vi.hoisted(() => ({
  mockAppQuota: { size: 0, limit: 1 },
  toastErrorMock: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}))

vi.mock('@/app/components/billing/apps-full-in-dialog', () => ({
  default: () => <div>apps-full</div>,
}))

function render(ui: ReactElement) {
  return renderWithConsoleQuery(ui, {
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: { apps: mockAppQuota },
  })
}

describe('DuplicateAppDialog', () => {
  const getIconButton = () =>
    screen.getByRole('button', {
      name: /operation\.edit.*appCustomize\.subTitle/,
    })

  beforeEach(() => {
    vi.clearAllMocks()
    mockAppQuota.size = 0
    mockAppQuota.limit = 1
  })

  it.each([
    { icon_type: null, icon: null, icon_background: null },
    { icon_type: 'link' as const, icon: 'https://example.com/icon.png', icon_background: null },
  ])(
    'preserves the source icon when duplicating without a new selection: %j',
    async (iconProps) => {
      const user = userEvent.setup()
      const onConfirm = vi.fn().mockResolvedValue(undefined)
      render(
        <DuplicateAppDialog
          appName="Copy"
          {...iconProps}
          open
          onConfirm={onConfirm}
          onOpenChange={vi.fn()}
        />,
      )

      await user.click(screen.getByRole('button', { name: /(?:^|\.)duplicate(?=$|:)/ }))

      expect(onConfirm).toHaveBeenCalledWith({ name: 'Copy', ...iconProps })
    },
  )

  it('should render a named dialog', () => {
    render(
      <DuplicateAppDialog
        appName="Demo App"
        icon_type="emoji"
        icon="🤖"
        open
        onConfirm={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog', { name: /duplicateTitle/ })).toBeInTheDocument()
  })

  it('should validate the name before duplicating and update the input value', async () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    const user = userEvent.setup()

    render(
      <DuplicateAppDialog
        appName="  "
        icon_type="emoji"
        icon="🤖"
        icon_background="#FFEAD5"
        open
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: /appCustomize\.subTitle/ })
    await user.clear(input)
    await user.type(input, 'Updated App')
    expect(input).toHaveValue('Updated App')

    await user.clear(input)
    await user.click(screen.getByRole('textbox', { name: /appCustomize\.subTitle/ }))
    await user.keyboard('{Enter}')

    expect(toastErrorMock).toHaveBeenCalledWith(
      expect.stringMatching(/(?:^|\.)appCustomize\.nameRequired(?=$|:)/),
    )
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('keeps the picker independent of the name field and submits only its confirmed icon', async () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    const user = userEvent.setup()

    render(
      <DuplicateAppDialog
        appName="Demo App"
        icon_type="emoji"
        icon="🤖"
        icon_background="#FFEAD5"
        open
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
      />,
    )

    await user.click(getIconButton())
    await waitFor(() => {
      expect(screen.getByPlaceholderText('app.iconPicker.search')).toBeInTheDocument()
    })
    await user.click(screen.getByPlaceholderText('app.iconPicker.search'))
    await user.keyboard('{Enter}')
    expect(onConfirm).not.toHaveBeenCalled()
    await user.click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
    await user.click(screen.getByRole('button', { name: /iconPicker\.ok/, hidden: true }))
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('app.iconPicker.search')).not.toBeInTheDocument()
    })
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: /appCustomize\.subTitle/ })).toHaveValue('Demo App')
    await user.click(screen.getByRole('button', { name: /(?:^|\.)duplicate(?=$|:)/ }))

    expect(onConfirm).toHaveBeenCalledWith({
      name: 'Demo App',
      icon_type: 'emoji',
      icon: '🤖',
      icon_background: '#F3FEE7',
    })
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('should call onOpenChange when close button is clicked', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()

    render(
      <DuplicateAppDialog
        appName="Demo App"
        icon_type="emoji"
        icon="🤖"
        icon_background="#FFEAD5"
        open
        onConfirm={vi.fn()}
        onOpenChange={onOpenChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.close(?=$|:)/ }))

    expect(onOpenChange).toHaveBeenCalledTimes(1)
  })

  it('should call onOpenChange when Escape is pressed', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()

    render(
      <DuplicateAppDialog
        appName="Demo App"
        icon_type="emoji"
        icon="🤖"
        open
        onConfirm={vi.fn()}
        onOpenChange={onOpenChange}
      />,
    )

    await user.keyboard('{Escape}')

    expect(onOpenChange).toHaveBeenCalledTimes(1)
  })

  it('should not submit with Enter when the app limit is reached', async () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    mockAppQuota.size = 1

    render(
      <DuplicateAppDialog
        appName="Demo App"
        icon_type="emoji"
        icon="🤖"
        open
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
      />,
    )

    await user.click(screen.getByRole('textbox', { name: /appCustomize\.subTitle/ }))
    await user.keyboard('{Enter}')

    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('should preserve the current image icon when the picker closes without selecting', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()

    render(
      <DuplicateAppDialog
        appName="Image App"
        icon_type="image"
        icon="original-file"
        icon_url="https://example.com/original.png"
        open
        onConfirm={onConfirm}
        onOpenChange={vi.fn()}
      />,
    )

    await user.click(getIconButton())
    const picker = screen.getByRole('dialog', { name: 'app.iconPicker.title' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(picker).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /(?:^|\.)duplicate(?=$|:)/ }))

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Image App',
        icon_type: 'image',
        icon: 'original-file',
      }),
    )
  })
})

it('waits for the real Cloud quota and allows an unlimited quota without an upgrade notice', async () => {
  const queryClient = createConsoleQueryClient()
  void queryClient.query({
    ...consoleQuery.features.get.queryOptions(),
    queryFn: () => new Promise(() => {}),
  })
  const onConfirm = vi.fn()
  renderWithConsoleQuery(
    <DuplicateAppDialog
      appName="Existing"
      icon_type="emoji"
      icon="🤖"
      open
      onConfirm={onConfirm}
      onOpenChange={vi.fn()}
    />,
    { queryClient, systemFeatures: { deployment_edition: 'CLOUD' } },
  )
  const button = screen.getByRole('button', { name: /(?:^|\.)duplicate(?=$|:)/ })
  expect(button).toBeDisabled()
  expect(screen.queryByText('apps-full')).not.toBeInTheDocument()
  await act(async () => {
    seedFeatures(queryClient, { apps: { size: 100, limit: 0 } })
  })
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.setup().click(button)
  expect(onConfirm).toHaveBeenCalledOnce()
})

it('waits for duplication, retains a failed draft and leaves successful closing to the caller', async () => {
  let rejectCopy!: (error: Error) => void
  let finishCopy!: () => void
  const onConfirm = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectCopy = reject
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishCopy = resolve
        }),
    )
  const onOpenChange = vi.fn()
  const user = userEvent.setup()
  render(
    <DuplicateAppDialog
      open
      appName="Original"
      icon_type="emoji"
      icon="🤖"
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
    />,
  )
  const name = screen.getByRole('textbox', { name: /appCustomize\.subTitle/ })
  await user.clear(name)
  await user.type(name, 'Retry copy{Enter}')
  await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
  expect(name).toHaveAttribute('readonly')
  const submit = screen.getByRole('button', { name: /(?:^|\.)duplicate(?=$|:)/ })
  expect(submit).toHaveAttribute('aria-disabled', 'true')
  const close = screen.getByRole('button', { name: /operation\.close/ })
  const cancel = screen.getByRole('button', { name: /operation\.cancel/ })
  expect(close).toBeDisabled()
  expect(cancel).toBeDisabled()
  expect(
    screen.getByRole('button', { name: /operation\.edit.*appCustomize\.subTitle/ }),
  ).toBeDisabled()
  await user.keyboard('{Enter}{Escape}')
  await user.click(close)
  await user.click(cancel)
  expect(onConfirm).toHaveBeenCalledOnce()
  expect(onOpenChange).not.toHaveBeenCalled()

  await act(async () => rejectCopy(new Error('Copy failed')))
  await waitFor(() => expect(name).not.toHaveAttribute('readonly'))
  expect(name).toHaveValue('Retry copy')
  expect(screen.getByRole('dialog', { name: /duplicateTitle/ })).toBeInTheDocument()
  await user.click(submit)
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2))
  expect(onConfirm).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Retry copy' }))
  await act(async () => finishCopy())
  await waitFor(() => expect(name).not.toHaveAttribute('readonly'))
  expect(onOpenChange).not.toHaveBeenCalled()
  await user.click(cancel)
  expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
})

it('discards name and confirmed icon drafts after closing and starts from the source when reopened', async () => {
  mockAppQuota.size = 0
  const onConfirm = vi.fn().mockResolvedValue(undefined)
  const user = userEvent.setup()
  function DuplicateSession() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open duplicate
        </button>
        <DuplicateAppDialog
          open={open}
          appName="Original"
          icon_type="emoji"
          icon="🤖"
          icon_background="#FFEAD5"
          onConfirm={onConfirm}
          onOpenChange={setOpen}
        />
      </>
    )
  }
  render(<DuplicateSession />)
  await user.click(screen.getByRole('button', { name: 'Open duplicate' }))
  const input = screen.getByRole('textbox', { name: /appCustomize\.subTitle/ })
  await user.clear(input)
  await user.type(input, 'Unsaved name')
  await user.click(screen.getByRole('button', { name: /operation\.edit.*appCustomize\.subTitle/ }))
  await user.click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
  await user.click(screen.getByRole('button', { name: /iconPicker\.ok/ }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'app.iconPicker.title' })).not.toBeInTheDocument(),
  )
  await user.click(screen.getByRole('button', { name: /operation\.cancel/ }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(onConfirm).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Open duplicate' }))
  expect(screen.getByRole('textbox', { name: /appCustomize\.subTitle/ })).toHaveValue('Original')
  await user.click(screen.getByRole('button', { name: /(?:^|\.)duplicate(?=$|:)/ }))
  expect(onConfirm).toHaveBeenCalledWith({
    name: 'Original',
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#FFEAD5',
  })
})

it('fetches Cloud quota only after its controlled root opens', async () => {
  const queryClient = createConsoleQueryClient()
  const fetchQuota = vi.spyOn(consoleBrowserLink, 'call').mockReturnValue(new Promise(() => {}))
  const user = userEvent.setup()
  function QuotaSession() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open duplicate
        </button>
        <DuplicateAppDialog
          open={open}
          appName="Original"
          icon_type="emoji"
          icon="🤖"
          onConfirm={vi.fn()}
          onOpenChange={setOpen}
        />
      </>
    )
  }
  renderWithConsoleQuery(<QuotaSession />, {
    queryClient,
    systemFeatures: { deployment_edition: 'CLOUD' },
  })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(fetchQuota).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Open duplicate' }))
  await waitFor(() => expect(fetchQuota).toHaveBeenCalledOnce())
  fetchQuota.mockRestore()
})
