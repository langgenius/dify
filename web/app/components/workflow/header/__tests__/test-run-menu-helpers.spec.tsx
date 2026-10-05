import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getNormalizedShortcutKey, SingleOptionTrigger } from '../test-run-menu-helpers'

describe('test-run-menu helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should normalize shortcut keys', () => {
    expect(getNormalizedShortcutKey(new KeyboardEvent('keydown', { key: '`' }))).toBe('~')
    expect(getNormalizedShortcutKey(new KeyboardEvent('keydown', { key: '1' }))).toBe('1')
  })

  it('should run single options for element and non-element children unless the click is prevented', async () => {
    const user = userEvent.setup()
    const runSoleOption = vi.fn()
    const originalOnClick = vi.fn()

    const { rerender } = render(
      <SingleOptionTrigger runSoleOption={runSoleOption}>Open directly</SingleOptionTrigger>,
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
