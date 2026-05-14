import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DuplicateAppModal from '../index'

const toastErrorMock = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

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
    <button type="button" onClick={onClick}>open-icon-picker</button>
  ),
}))

vi.mock('@/app/components/base/app-icon-picker', () => ({
  default: ({ onSelect, onClose }: { onSelect: (payload: Record<string, unknown>) => void, onClose: () => void }) => (
    <div data-testid="app-icon-picker">
      <button type="button" onClick={() => onSelect({ type: 'image', fileId: 'file-1', url: 'https://example.com/icon.png' })}>select-icon</button>
      <button type="button" onClick={onClose}>close-icon-picker</button>
    </div>
  ),
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
    await user.click(screen.getByRole('button', { name: 'duplicate' }))

    expect(toastErrorMock).toHaveBeenCalledWith('appCustomize.nameRequired')
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
    await user.click(screen.getByText('select-icon'))
    await user.click(screen.getByRole('button', { name: 'duplicate' }))

    expect(onConfirm).toHaveBeenCalledWith({
      name: 'Demo App',
      icon_type: 'image',
      icon: 'file-1',
      icon_background: undefined,
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

    await user.click(screen.getByRole('button', { name: 'operation.close' }))

    expect(onHide).toHaveBeenCalledTimes(1)
  })

  it('should restore the original image icon when the picker closes without selecting', async () => {
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
    await user.click(screen.getByText('select-icon'))
    await user.click(screen.getByText('open-icon-picker'))
    await user.click(screen.getByText('close-icon-picker'))
    await user.click(screen.getByRole('button', { name: 'duplicate' }))

    expect(onConfirm).toHaveBeenCalledWith({
      name: 'Image App',
      icon_type: 'image',
      icon: 'original-file',
      icon_background: undefined,
    })
  })
})
