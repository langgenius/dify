import * as jestDomMatchers from '@testing-library/jest-dom/matchers'
import { act, cleanup } from '@testing-library/react'
import * as React from 'react'
import '@testing-library/jest-dom/vitest'
import 'vitest-canvas-mock'

expect.extend(jestDomMatchers)

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
    readonly scrollMargin: string = ''
    readonly thresholds: ReadonlyArray<number> = []
    constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) { /* noop */ }
    observe(_target: Element) { /* noop */ }
    unobserve(_target: Element) { /* noop */ }
    disconnect() { /* noop */ }
    takeRecords(): IntersectionObserverEntry[] { return [] }
  }
}

afterEach(async () => {
  // Wrap cleanup in act() to flush pending React scheduler work
  // This prevents "window is not defined" errors from React 19's scheduler
  // which uses setImmediate/MessageChannel that can fire after DOM cleanup
  await act(async () => {
    cleanup()
  })
})

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

// Mock FloatingPortal to render children in the normal DOM flow
vi.mock('@floating-ui/react', async () => {
  const actual = await vi.importActual('@floating-ui/react')
  return {
    ...actual,
    FloatingPortal: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-floating-ui-portal': true }, children),
  }
})

vi.mock('@monaco-editor/react', () => {
  const createEditorMock = () => {
    const focusListeners: Array<() => void> = []
    const blurListeners: Array<() => void> = []

    return {
      getContentHeight: vi.fn(() => 56),
      onDidFocusEditorText: vi.fn((listener: () => void) => {
        focusListeners.push(listener)
        return { dispose: vi.fn() }
      }),
      onDidBlurEditorText: vi.fn((listener: () => void) => {
        blurListeners.push(listener)
        return { dispose: vi.fn() }
      }),
      layout: vi.fn(),
      getAction: vi.fn(() => ({ run: vi.fn() })),
      getModel: vi.fn(() => ({
        getLineContent: vi.fn(() => ''),
      })),
      getPosition: vi.fn(() => ({ lineNumber: 1, column: 1 })),
      deltaDecorations: vi.fn(() => []),
      focus: vi.fn(() => {
        focusListeners.forEach(listener => listener())
      }),
      setPosition: vi.fn(),
      revealLine: vi.fn(),
      trigger: vi.fn(),
      __blur: () => {
        blurListeners.forEach(listener => listener())
      },
    }
  }

  const monacoMock = {
    editor: {
      setTheme: vi.fn(),
      defineTheme: vi.fn(),
    },
    Range: class {
      startLineNumber: number
      startColumn: number
      endLineNumber: number
      endColumn: number
      constructor(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) {
        this.startLineNumber = startLineNumber
        this.startColumn = startColumn
        this.endLineNumber = endLineNumber
        this.endColumn = endColumn
      }
    },
  }

  const MonacoEditor = ({
    value = '',
    onChange,
    onMount,
    options,
  }: {
    value?: string
    onChange?: (value: string | undefined) => void
    onMount?: (editor: ReturnType<typeof createEditorMock>, monaco: typeof monacoMock) => void
    options?: { readOnly?: boolean }
  }) => {
    const editorRef = React.useRef<ReturnType<typeof createEditorMock> | null>(null)
    if (!editorRef.current)
      editorRef.current = createEditorMock()

    React.useEffect(() => {
      onMount?.(editorRef.current!, monacoMock)
    }, [onMount])

    return React.createElement('textarea', {
      'data-testid': 'monaco-editor',
      'readOnly': options?.readOnly,
      value,
      'onChange': (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.(event.target.value),
      'onFocus': () => editorRef.current?.focus(),
      'onBlur': () => editorRef.current?.__blur(),
    })
  }

  return {
    __esModule: true,
    default: MonacoEditor,
    Editor: MonacoEditor,
    loader: {
      config: vi.fn(),
      init: vi.fn().mockResolvedValue(monacoMock),
    },
  }
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
