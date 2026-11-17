import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { TitleInput } from '../title-description-input'

it.each([{ isComposing: true }, { keyCode: 229 }])(
  'keeps editing the node title when Enter confirms an IME candidate (%o)',
  async (imeEvent) => {
    const onBlur = vi.fn()
    const screen = await render(<TitleInput value="Summarize" onBlur={onBlur} />)
    const title = screen.getByRole('textbox')
    await title.fill('zhai')
    const confirm = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      ...imeEvent,
    })
    title.element().dispatchEvent(confirm)
    expect(confirm.defaultPrevented).toBe(false)
    await expect.element(title).toHaveFocus()
    expect(onBlur).not.toHaveBeenCalled()

    await title.fill('摘要')
    await userEvent.keyboard('{Enter}')
    expect(onBlur).toHaveBeenCalledExactlyOnceWith('摘要')
  },
)
