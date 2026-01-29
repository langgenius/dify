import { act, cleanup } from '@testing-library/react'
import { mockAnimationsApi, mockResizeObserver } from 'jsdom-testing-mocks'
import '@testing-library/jest-dom/vitest'

mockResizeObserver()

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
        value: typeof original === 'function' ? original : vi.fn(),
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

// Mock IntersectionObserver for tests
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class {
    readonly root: Element | Document | null = null
    readonly rootMargin: string = ''
    readonly thresholds: ReadonlyArray<number> = []
    constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) { /* noop */ }
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
    takeRecords(): IntersectionObserverEntry[] { return [] }
  }
}

// Mock Element.scrollIntoView for tests (not available in happy-dom/jsdom)
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView)
  Element.prototype.scrollIntoView = function () { /* noop */ }

afterEach(async () => {
  // Wrap cleanup in act() to flush pending React scheduler work
  // This prevents "window is not defined" errors from React 19's scheduler
  // which uses setImmediate/MessageChannel that can fire after jsdom cleanup
  await act(async () => {
    cleanup()
  })
})

// mock next/image to avoid width/height requirements for data URLs
vi.mock('next/image')

// mock foxact/use-clipboard - not available in test environment
vi.mock('foxact/use-clipboard', () => ({
  useClipboard: () => ({
    copy: vi.fn(),
    copied: false,
  }),
}))

// mock zustand - auto-resets all stores after each test
// Based on official Zustand testing guide: https://zustand.docs.pmnd.rs/guides/testing
vi.mock('zustand')

// mock react-i18next
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const { createReactI18nextMock } = await import('./test/i18n-mock')
  return {
    ...actual,
    ...createReactI18nextMock(),
  }
})

// mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock localStorage for testing
const createMockLocalStorage = () => {
  const storage: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => storage[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      storage[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete storage[key]
    }),
    clear: vi.fn(() => {
      Object.keys(storage).forEach(key => delete storage[key])
    }),
    get storage() { return { ...storage } },
  }
}

let mockLocalStorage: ReturnType<typeof createMockLocalStorage>

beforeEach(() => {
  vi.clearAllMocks()
  mockLocalStorage = createMockLocalStorage()
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockLocalStorage,
    writable: true,
    configurable: true,
  })
})
