import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'

// Fix for @headlessui/react compatibility with happy-dom
// headlessui tries to set focus property which is read-only in happy-dom
if (typeof window !== 'undefined') {
  // Ensure window.focus is writable for headlessui
  if (!Object.getOwnPropertyDescriptor(window, 'focus')?.writable) {
    Object.defineProperty(window, 'focus', {
      value: jest.fn(),
      writable: true,
      configurable: true,
    })
  }
}

afterEach(() => {
  cleanup()
})
