import type { ReactElement } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery,
  seedFeatures,
} from '@/test/console/query-data'
import { mockEmojiData } from '@/test/emoji-picker'
import DuplicateAppModal from '../index'

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

describe('DuplicateAppModal', () => {
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
        <DuplicateAppModal
          appName="Copy"
          {...iconProps}
          show
          onConfirm={onConfirm}
          onHide={vi.fn()}
        />,
      )

      await user.click(screen.getByRole('button', { name: /(?:^|\.)duplicate(?=$|:)/ }))

      expect(onConfirm).toHaveBeenCalledWith({ name: 'Copy', ...iconProps })
    },
  )

  it('should render a named dialog', () => {
    render(
      <DuplicateAppModal
        appName="Demo App"
        icon_type="emoji"
        icon="🤖"
        show
        onConfirm={vi.fn()}
        onHide={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog', { name: /duplicateTitle/ })).toBeInTheDocument()
  })

  it('should validate the name before duplicating and update the input value', async () => {
    const onConfirm = vi.fn()
    const onHide = vi.fn()
    const user = userEvent.setup()

    render(
      <DuplicateAppModal
        appName="  "
        icon_type="emoji"
        icon="🤖"
        icon_background="#FFEAD5"
        show
        onConfirm={onConfirm}
        onHide={onHide}
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
    expect(onHide).not.toHaveBeenCalled()
  })

  it('keeps the picker independent of the name field and submits only its confirmed icon', async () => {
    const onConfirm = vi.fn()
    const onHide = vi.fn()
    const user = userEvent.setup()

    render(
      <DuplicateAppModal
        appName="Demo App"
        icon_type="emoji"
        icon="🤖"
        icon_background="#FFEAD5"
        show
        onConfirm={onConfirm}
        onHide={onHide}
      />,
    )

    await user.click(getIconButton())
    await waitFor(() => {
      expect(screen.getByPlaceholderText('app.iconPicker.search')).toBeInTheDocument()
    })
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
    expect(onHide).toHaveBeenCalled()
  })

  it('should call onHide when close button is clicked', async () => {
    const onHide = vi.fn()
    const user = userEvent.setup()

    render(
      <DuplicateAppModal
        appName="Demo App"
        icon_type="emoji"
        icon="🤖"
        icon_background="#FFEAD5"
        show
        onConfirm={vi.fn()}
        onHide={onHide}
      />,
    )

    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.close(?=$|:)/ }))

    expect(onHide).toHaveBeenCalledTimes(1)
  })

  it('should call onHide when Escape is pressed', async () => {
    const onHide = vi.fn()
    const user = userEvent.setup()

    render(
      <DuplicateAppModal
        appName="Demo App"
        icon_type="emoji"
        icon="🤖"
        show
        onConfirm={vi.fn()}
        onHide={onHide}
      />,
    )

    await user.keyboard('{Escape}')

    expect(onHide).toHaveBeenCalledTimes(1)
  })

  it('should not submit with Enter when the app limit is reached', async () => {
    const onConfirm = vi.fn()
    const onHide = vi.fn()
    const user = userEvent.setup()
    mockAppQuota.size = 1

    render(
      <DuplicateAppModal
        appName="Demo App"
        icon_type="emoji"
        icon="🤖"
        show
        onConfirm={onConfirm}
        onHide={onHide}
      />,
    )

    await user.click(screen.getByRole('textbox', { name: /appCustomize\.subTitle/ }))
    await user.keyboard('{Enter}')

    expect(onConfirm).not.toHaveBeenCalled()
    expect(onHide).not.toHaveBeenCalled()
  })

  it('should preserve the current image icon when the picker closes without selecting', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()

    render(
      <DuplicateAppModal
        appName="Image App"
        icon_type="image"
        icon="original-file"
        icon_url="https://example.com/original.png"
        show
        onConfirm={onConfirm}
        onHide={vi.fn()}
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
    <DuplicateAppModal
      appName="Existing"
      icon_type="emoji"
      icon="🤖"
      show
      onConfirm={onConfirm}
      onHide={vi.fn()}
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
