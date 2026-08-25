import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdvancedActions } from '../advanced-actions'

const hotkeyRegistrations = vi.hoisted(
  () =>
    new Map<
      string,
      {
        callback: () => void
        options?: { enabled?: boolean; ignoreInputs?: boolean }
      }
    >(),
)

vi.mock('@tanstack/react-hotkeys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-hotkeys')>()
  return {
    ...actual,
    useHotkey: (
      hotkey: string,
      callback: () => void,
      options?: { enabled?: boolean; ignoreInputs?: boolean },
    ) => {
      hotkeyRegistrations.set(hotkey, { callback, options })
    },
  }
})

describe('AdvancedActions', () => {
  beforeEach(() => {
    hotkeyRegistrations.clear()
  })

  it('runs the matching actions from the buttons', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<AdvancedActions isConfirmDisabled={false} onCancel={onCancel} onConfirm={onConfirm} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await user.click(screen.getByRole('button', { name: /^common\.operation\.confirm/ }))

    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('registers the confirm shortcut for input fields', () => {
    const onConfirm = vi.fn()
    render(<AdvancedActions isConfirmDisabled={false} onCancel={vi.fn()} onConfirm={onConfirm} />)

    const registration = hotkeyRegistrations.get('Mod+Enter')
    registration?.callback()

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(registration?.options).toEqual({ enabled: true, ignoreInputs: false })
  })

  it('disables both confirmation paths when confirmation is unavailable', () => {
    render(<AdvancedActions isConfirmDisabled onCancel={vi.fn()} onConfirm={vi.fn()} />)

    expect(screen.getByRole('button', { name: /^common\.operation\.confirm/ })).toBeDisabled()
    expect(hotkeyRegistrations.get('Mod+Enter')?.options?.enabled).toBe(false)
  })
})
