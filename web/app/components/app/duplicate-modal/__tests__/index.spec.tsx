import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DuplicateAppModal from '../index'

const toastErrorMock = vi.fn()
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    plan: {
      usage: { buildApps: 0 },
      total: { buildApps: 1 },
    },
    enableBilling: true,
  }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: ({ onClick }: { onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      open-icon-picker
    </button>
  ),
}))

vi.mock('@/app/components/base/app-icon-picker', () => ({
  default: ({
    onOpenChange,
    onSelect,
  }: {
    onOpenChange: (open: boolean) => void
    onSelect: (payload: { type: 'emoji'; icon: string; background: string }) => void
  }) => {
    let selectedBackground = '#FFEAD5'
    return (
      <div>
        <input placeholder="Search emojis..." />
        <button type="button" onClick={() => {}}>
          <em-emoji />
        </button>
        <button
          type="button"
          aria-label="#E4FBCC"
          onClick={() => {
            selectedBackground = '#E4FBCC'
          }}
        />
        <button
          type="button"
          onClick={() => {
            onSelect({ type: 'emoji', icon: '🤖', background: selectedBackground })
            onOpenChange(false)
          }}
        >
          iconPicker.ok
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          iconPicker.cancel
        </button>
      </div>
    )
  },
}))

describe('DuplicateAppModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Updated App')
    expect(input).toHaveValue('Updated App')

    await user.clear(input)
    await user.click(screen.getByRole('button', { name: /(?:^|\.)duplicate(?=$|:)/ }))

    expect(toastErrorMock).toHaveBeenCalledWith(
      expect.stringMatching(/(?:^|\.)appCustomize\.nameRequired(?=$|:)/),
    )
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onHide).not.toHaveBeenCalled()
  })

  it('should update the selected icon before confirming the duplicate', async () => {
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

    await user.click(screen.getByText('open-icon-picker'))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search emojis...')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: '#E4FBCC', hidden: true }))
    await user.click(screen.getByRole('button', { name: /iconPicker\.ok/, hidden: true }))
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search emojis...')).not.toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /(?:^|\.)duplicate(?=$|:)/ }))

    expect(onConfirm).toHaveBeenCalledWith({
      name: 'Demo App',
      icon_type: 'emoji',
      icon: '🤖',
      icon_background: '#E4FBCC',
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

    await user.click(screen.getByText('open-icon-picker'))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search emojis...')).toBeInTheDocument()
    })
    const emojiButton = document.querySelector('em-emoji')?.closest('button')
    expect(emojiButton).toBeTruthy()
    await user.click(emojiButton!)
    await user.click(screen.getByRole('button', { name: '#E4FBCC', hidden: true }))
    await user.click(screen.getByRole('button', { name: /iconPicker\.ok/, hidden: true }))
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search emojis...')).not.toBeInTheDocument()
    })
    await user.click(screen.getByText('open-icon-picker'))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search emojis...')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /iconPicker\.cancel/, hidden: true }))
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search emojis...')).not.toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /(?:^|\.)duplicate(?=$|:)/ }))

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Image App',
        icon_type: 'emoji',
        icon: expect.any(String),
        icon_background: '#E4FBCC',
      }),
    )
  })
})
