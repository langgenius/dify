import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { mockAnimationsApi } from 'jsdom-testing-mocks'

// Mock Web Animations API for Headless UI
mockAnimationsApi()

// Suppress act() warnings from @headlessui/react internal Transition component
// These warnings are caused by Headless UI's internal async state updates, not our code
const originalConsoleError = console.error
console.error = (...args: unknown[]) => {
  // Check all arguments for the Headless UI TransitionRootFn act warning
  const fullMessage = args.map(arg => (typeof arg === 'string' ? arg : '')).join(' ')
  if (fullMessage.includes('TransitionRootFn') && fullMessage.includes('not wrapped in act'))
    return
  originalConsoleError.apply(console, args)
}

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
