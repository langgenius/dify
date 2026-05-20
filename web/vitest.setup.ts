import * as jestDomMatchers from '@testing-library/jest-dom/matchers'
import { act, cleanup } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, expect, vi } from 'vitest'
import 'vitest-canvas-mock'

if (typeof expect.extend === 'function') {
  expect.extend(jestDomMatchers)
}

(
  globalThis as typeof globalThis & {
    BASE_UI_ANIMATIONS_DISABLED: boolean
  }
).BASE_UI_ANIMATIONS_DISABLED = true

// Base UI waits for element animations while closing overlays.
if (typeof window !== 'undefined') {
  if (typeof Element !== 'undefined' && !Element.prototype.getAnimations)
    Element.prototype.getAnimations = () => []

  if (!document.getAnimations)
    document.getAnimations = () => []
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

// Mock global fetch to prevent happy-dom from making real network calls
// (which would cause ECONNREFUSED errors against localhost:5001).
// Individual tests can still override via vi.spyOn(globalThis, 'fetch') or reassignment.
globalThis.fetch = vi.fn(() =>
  Promise.resolve(
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
) as unknown as typeof fetch

afterEach(async () => {
  // Wrap cleanup in act() to flush pending React scheduler work
  // This prevents "window is not defined" errors from React 19's scheduler
  // which uses setImmediate/MessageChannel that can fire after DOM cleanup
  await act(async () => {
    cleanup()
  })
})

// mock custom clipboard hook - wraps writeTextToClipboard with fallback
vi.mock('@/hooks/use-clipboard', () => ({
  useClipboard: () => ({
    copy: vi.fn(),
    copied: false,
    reset: vi.fn(),
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
