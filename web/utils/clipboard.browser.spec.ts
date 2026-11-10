import { page } from 'vite-plus/test/browser'
import { writeTextToClipboard } from './clipboard'

let copyButton: HTMLButtonElement

beforeEach(() => {
  copyButton = document.createElement('button')
  copyButton.type = 'button'
  copyButton.textContent = 'Copy tool name'
  document.body.appendChild(copyButton)
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
    new DOMException('Clipboard access denied', 'NotAllowedError'),
  )
})

afterEach(() => {
  copyButton.remove()
  vi.restoreAllMocks()
})

it.each(['success', 'failure', 'exception'] as const)(
  'retains action focus after the legacy copy reports %s',
  async (outcome) => {
    const copy = vi.spyOn(document, 'execCommand').mockImplementation(() => {
      if (outcome === 'exception') throw new Error('Copy denied')
      return outcome === 'success'
    })
    const completed = new Promise<unknown>((resolve) => {
      copyButton.addEventListener('click', () => {
        void writeTextToClipboard('search_tool').then(
          () => resolve(undefined),
          (error: unknown) => resolve(error),
        )
      })
    })

    const action = page.getByRole('button', { name: 'Copy tool name' })
    await action.click()
    const error = await completed

    if (outcome === 'success') expect(error).toBeUndefined()
    else
      expect(error).toEqual(
        new Error(outcome === 'exception' ? 'Copy denied' : 'document.execCommand failed'),
      )
    expect(copy).toHaveBeenCalledExactlyOnceWith('copy')
    await expect.element(action).toHaveFocus()
    expect(document.querySelector('textarea')).toBeNull()
  },
)
