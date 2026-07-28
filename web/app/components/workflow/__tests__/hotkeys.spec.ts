import { detectPlatform } from '@tanstack/react-hotkeys'
import { shouldPreventWorkflowBrowserDefault } from '../hotkeys'

const primaryModifier = detectPlatform() === 'mac' ? { metaKey: true } : { ctrlKey: true }

function createKeyboardEvent(key: string, modifiers: KeyboardEventInit = {}) {
  return new KeyboardEvent('keydown', { key, ...modifiers })
}

describe('workflow browser default hotkeys', () => {
  it.each(['d', 'z', 'y', 's'])('matches the exact Mod+%s browser guard', (key) => {
    expect(shouldPreventWorkflowBrowserDefault(createKeyboardEvent(key, primaryModifier))).toBe(
      true,
    )
  })

  it('matches the alternate redo hotkey', () => {
    expect(
      shouldPreventWorkflowBrowserDefault(
        createKeyboardEvent('z', { ...primaryModifier, shiftKey: true }),
      ),
    ).toBe(true)
  })

  it('does not match plain or over-modified keys', () => {
    expect(shouldPreventWorkflowBrowserDefault(createKeyboardEvent('s'))).toBe(false)
    expect(
      shouldPreventWorkflowBrowserDefault(
        createKeyboardEvent('s', { ...primaryModifier, shiftKey: true }),
      ),
    ).toBe(false)
  })
})
