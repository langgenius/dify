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
  // Provide a minimal animations API polyfill before @headlessui/react boots
  if (typeof Element !== 'undefined' && !Element.prototype.getAnimations)
    Element.prototype.getAnimations = () => []

  if (!document.getAnimations)
    document.getAnimations = () => []

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

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {
      return undefined
    }

    unobserve() {
      return undefined
    }

    disconnect() {
      return undefined
    }
  }
}

afterEach(() => {
  cleanup()
})
