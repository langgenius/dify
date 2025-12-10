import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'

// Fix for @headlessui/react compatibility with happy-dom
// headlessui tries to override HTMLElement.prototype.focus which may be read-only in happy-dom
if (typeof window !== 'undefined') {
  // Ensure window.focus is writable for headlessui
  if (!Object.getOwnPropertyDescriptor(window, 'focus')?.writable) {
    Object.defineProperty(window, 'focus', {
      value: jest.fn(),
      writable: true,
      configurable: true,
    })
  }

  // Ensure HTMLElement.prototype.focus is writable for headlessui
  // headlessui's setupGlobalFocusEvents tries to replace this method
  const focusDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'focus')
  if (focusDescriptor && !focusDescriptor.writable) {
    const originalFocus = focusDescriptor.value || focusDescriptor.get?.call(HTMLElement.prototype) || jest.fn()
    Object.defineProperty(HTMLElement.prototype, 'focus', {
      value: typeof originalFocus === 'function' ? originalFocus : jest.fn(),
      writable: true,
      configurable: true,
    })
  }
}

afterEach(() => {
  cleanup()
})
