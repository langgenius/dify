import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'

// Fix for @headlessui/react compatibility with happy-dom
// headlessui tries to override focus properties which may be read-only in happy-dom
if (typeof window !== 'undefined') {
  const ensureWritable = (target: object, prop: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, prop)
    if (descriptor && !descriptor.writable) {
      const original = descriptor.value ?? descriptor.get?.call(target)
      Object.defineProperty(target, prop, {
        value: typeof original === 'function' ? original : jest.fn(),
        writable: true,
        configurable: true,
      })
    }
  }

  ensureWritable(window, 'focus')
  ensureWritable(HTMLElement.prototype, 'focus')
}

afterEach(() => {
  cleanup()
})
