import { vi } from 'vite-plus/test'

/**
 * Give each iframe a stable stand-in `contentWindow`, since happy-dom does not load iframe pages
 * by default. Restore mocks after each test.
 */
export function stubIframeContentWindow() {
  const windows = new WeakMap<HTMLIFrameElement, Window>()
  return vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockImplementation(function (
    this: HTMLIFrameElement,
  ) {
    let frameWindow = windows.get(this)
    if (!frameWindow) {
      frameWindow = { postMessage: () => {} } as unknown as Window
      windows.set(this, frameWindow)
    }
    return frameWindow
  })
}
