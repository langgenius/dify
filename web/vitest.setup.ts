import { act, cleanup } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import 'vitest-canvas-mock'

;(
  globalThis as typeof globalThis & {
    BASE_UI_ANIMATIONS_DISABLED: boolean
  }
).BASE_UI_ANIMATIONS_DISABLED = true

if (typeof Element !== 'undefined' && !Element.prototype.getAnimations)
  Element.prototype.getAnimations = () => []

const unexpectedFetchCalls: Parameters<typeof fetch>[] = []
const unexpectedFetchMock = vi.fn((...args: Parameters<typeof fetch>) => {
  unexpectedFetchCalls.push(args)
  return new Promise<Response>(() => {})
}) as typeof fetch
globalThis.fetch = unexpectedFetchMock

afterEach(async () => {
  // Wrap cleanup in act() to flush pending React scheduler work
  // This prevents "window is not defined" errors from React 19's scheduler
  // which uses setImmediate/MessageChannel that can fire after DOM cleanup
  await act(async () => {
    cleanup()
  })

  if (unexpectedFetchCalls.length) {
    const requests = unexpectedFetchCalls.map(([input]) =>
      input instanceof Request ? input.url : String(input),
    )
    throw new Error(`Unexpected fetch request(s): ${requests.join(', ')}`)
  }
})

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
      focus: vi.fn(() => {
        focusListeners.forEach((listener) => listener())
      }),
      __blur: () => {
        blurListeners.forEach((listener) => listener())
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
      constructor(
        startLineNumber: number,
        startColumn: number,
        endLineNumber: number,
        endColumn: number,
      ) {
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
    if (!editorRef.current) editorRef.current = createEditorMock()

    React.useEffect(() => {
      onMount?.(editorRef.current!, monacoMock)
    }, [onMount])

    return React.createElement('textarea', {
      'data-testid': 'monaco-editor',
      readOnly: options?.readOnly,
      value,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.(event.target.value),
      onFocus: () => editorRef.current?.focus(),
      onBlur: () => editorRef.current?.__blur(),
    })
  }

  return {
    __esModule: true,
    default: MonacoEditor,
    Editor: MonacoEditor,
    loader: {
      config: vi.fn(),
    },
  }
})

beforeEach(() => {
  unexpectedFetchCalls.length = 0
  vi.mocked(unexpectedFetchMock).mockClear()
  globalThis.fetch = unexpectedFetchMock
  if (typeof localStorage !== 'undefined') localStorage.clear()
})
