import { writeTextToClipboard } from './clipboard'

let clipboardDescriptor: PropertyDescriptor | undefined
let execCommandDescriptor: PropertyDescriptor | undefined
beforeEach(() => {
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  execCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand')
  vi.stubGlobal('isSecureContext', true)
})
afterEach(() => {
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
  else Reflect.deleteProperty(navigator, 'clipboard')
  if (execCommandDescriptor) Object.defineProperty(document, 'execCommand', execCommandDescriptor)
  else Reflect.deleteProperty(document, 'execCommand')
  vi.unstubAllGlobals()
})
const setClipboard = (writeText?: (text: string) => Promise<void>) =>
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  })
const setExecCommand = (copy: () => boolean) =>
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: copy,
  })

it('copies the original text with the modern API without falling back', async () => {
  const write = vi.fn().mockResolvedValue(undefined)
  const legacyCopy = vi.fn()
  setClipboard(write)
  setExecCommand(legacyCopy)
  const text = 'Test\n\t"quotes"\n中文\n😀'
  await writeTextToClipboard(text)
  expect(write).toHaveBeenCalledExactlyOnceWith(text)
  expect(legacyCopy).not.toHaveBeenCalled()
})

it.each(['unavailable', 'permission denied'] as const)(
  'copies through the legacy API when the clipboard is %s and removes temporary content',
  async (reason) => {
    setClipboard(
      reason === 'permission denied'
        ? vi.fn().mockRejectedValue(new Error('Not allowed'))
        : undefined,
    )
    let selected: HTMLTextAreaElement | undefined
    const legacyCopy = vi.fn(() => {
      selected = document.activeElement as HTMLTextAreaElement
      expect(selected.value).toBe('Fallback text')
      expect(selected.selectionStart).toBe(0)
      expect(selected.selectionEnd).toBe(selected.value.length)
      return true
    })
    setExecCommand(legacyCopy)
    await writeTextToClipboard('Fallback text')
    expect(legacyCopy).toHaveBeenCalledExactlyOnceWith('copy')
    expect(selected?.isConnected).toBe(false)
  },
)

it.each(['failure', 'exception'] as const)(
  'rejects legacy %s and still removes the temporary selection',
  async (outcome) => {
    setClipboard()
    const selection: { current: Element | null } = { current: null }
    setExecCommand(() => {
      selection.current = document.activeElement
      if (outcome === 'exception') throw new Error('Copy denied')
      return false
    })
    await expect(writeTextToClipboard('Cannot copy')).rejects.toThrow(
      outcome === 'exception' ? 'Copy denied' : 'document.execCommand failed',
    )
    expect(selection.current).not.toBeNull()
    expect(selection.current?.isConnected).toBe(false)
  },
)
