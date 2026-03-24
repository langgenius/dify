import type { TriggerOption } from '../test-run-menu'
import { fireEvent, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { TriggerType } from '../test-run-menu'
import {
  getNormalizedShortcutKey,
  OptionRow,
  SingleOptionTrigger,
  useShortcutMenu,
} from '../test-run-menu-helpers'

vi.mock('../shortcuts-name', () => ({
  default: ({ keys }: { keys: string[] }) => <span>{keys.join('+')}</span>,
}))

const createOption = (overrides: Partial<TriggerOption> = {}): TriggerOption => ({
  id: 'user-input',
  type: TriggerType.UserInput,
  name: 'User Input',
  icon: <span>icon</span>,
  enabled: true,
  ...overrides,
})

describe('test-run-menu helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should normalize shortcut keys and render option rows with clickable shortcuts', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const option = createOption()

    expect(getNormalizedShortcutKey(new KeyboardEvent('keydown', { key: '`' }))).toBe('~')
    expect(getNormalizedShortcutKey(new KeyboardEvent('keydown', { key: '1' }))).toBe('1')

    render(
      <OptionRow
        option={option}
        shortcutKey="1"
        onSelect={onSelect}
      />,
    )

    expect(screen.getByText('1')).toBeInTheDocument()

    await user.click(screen.getByText('User Input'))

    expect(onSelect).toHaveBeenCalledWith(option)
  })

  it('should handle shortcut key presses only when the menu is open and the event is eligible', () => {
    const handleSelect = vi.fn()
    const option = createOption({ id: 'run-all', type: TriggerType.All, name: 'Run All' })

    const { rerender, unmount } = renderHook(({ open }) => useShortcutMenu({
      open,
      shortcutMappings: [{ option, shortcutKey: '~' }],
      handleSelect,
    }), {
      initialProps: { open: true },
    })

    fireEvent.keyDown(window, { key: '`' })
    fireEvent.keyDown(window, { key: '`', altKey: true })
    fireEvent.keyDown(window, { key: '`', repeat: true })

    const preventedEvent = new KeyboardEvent('keydown', { key: '`', cancelable: true })
    preventedEvent.preventDefault()
    window.dispatchEvent(preventedEvent)

    expect(handleSelect).toHaveBeenCalledTimes(1)
    expect(handleSelect).toHaveBeenCalledWith(option)

    rerender({ open: false })
    fireEvent.keyDown(window, { key: '`' })
    expect(handleSelect).toHaveBeenCalledTimes(1)

    unmount()
    fireEvent.keyDown(window, { key: '`' })
    expect(handleSelect).toHaveBeenCalledTimes(1)
  })

  it('should run single options for element and non-element children unless the click is prevented', async () => {
    const user = userEvent.setup()
    const runSoleOption = vi.fn()
    const originalOnClick = vi.fn()

    const { rerender } = render(
      <SingleOptionTrigger runSoleOption={runSoleOption}>
        Open directly
      </SingleOptionTrigger>,
    )

    await user.click(screen.getByText('Open directly'))
    expect(runSoleOption).toHaveBeenCalledTimes(1)

    rerender(
      <SingleOptionTrigger runSoleOption={runSoleOption}>
        <button onClick={originalOnClick}>Child trigger</button>
      </SingleOptionTrigger>,
    )

    await user.click(screen.getByRole('button', { name: 'Child trigger' }))
    expect(originalOnClick).toHaveBeenCalledTimes(1)
    expect(runSoleOption).toHaveBeenCalledTimes(2)

    rerender(
      <SingleOptionTrigger runSoleOption={runSoleOption}>
        <button
          onClick={(event) => {
            event.preventDefault()
            originalOnClick()
          }}
        >
          Prevented child
        </button>
      </SingleOptionTrigger>,
    )

    await user.click(screen.getByRole('button', { name: 'Prevented child' }))

    expect(originalOnClick).toHaveBeenCalledTimes(2)
    expect(runSoleOption).toHaveBeenCalledTimes(2)
  })
})
