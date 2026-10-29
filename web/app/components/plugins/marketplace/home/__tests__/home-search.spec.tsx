import { detectPlatform } from '@tanstack/react-hotkeys'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HomeSearch from '../home-search'

const modifier = detectPlatform() === 'mac' ? { metaKey: true } : { ctrlKey: true }

describe('HomeSearch shortcut', () => {
  it('focuses standalone search and leaves the console binding disabled', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <>
        <button>Outside</button>
        <HomeSearch>
          <input aria-label="Marketplace search" />
        </HomeSearch>
      </>,
    )
    await user.click(screen.getByRole('button', { name: 'Outside' }))
    fireEvent.keyDown(document.activeElement!, { key: 'k', ...modifier })
    expect(screen.getByRole('textbox', { name: 'Marketplace search' })).toHaveFocus()
    fireEvent.keyUp(document.activeElement!, { key: 'k', ...modifier })
    rerender(
      <>
        <button>Outside</button>
        <HomeSearch enableSearchShortcut={false}>
          <input aria-label="Marketplace search" />
        </HomeSearch>
      </>,
    )
    await user.click(screen.getByRole('button', { name: 'Outside' }))
    fireEvent.keyDown(document.activeElement!, { key: 'k', ...modifier })
    expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus()
  })

  it('preserves input composition and shortcuts claimed by a nearer owner', async () => {
    const user = userEvent.setup()
    render(
      <>
        <input aria-label="Editor" onKeyDown={(event) => event.preventDefault()} />
        <input aria-label="Description" />
        <HomeSearch>
          <input aria-label="Marketplace search" />
        </HomeSearch>
      </>,
    )
    const editor = screen.getByRole('textbox', { name: 'Editor' })
    await user.click(editor)
    fireEvent.keyDown(editor, { key: 'k', ...modifier })
    expect(editor).toHaveFocus()
    fireEvent.keyUp(editor, { key: 'k', ...modifier })

    const description = screen.getByRole('textbox', { name: 'Description' })
    await user.click(description)
    expect(fireEvent.keyDown(description, { key: 'k', ...modifier, isComposing: true })).toBe(true)
    expect(description).toHaveFocus()
    fireEvent.keyUp(description, { key: 'k', ...modifier })
    fireEvent.keyDown(description, { key: 'k', ...modifier })
    expect(screen.getByRole('textbox', { name: 'Marketplace search' })).toHaveFocus()
  })
})
