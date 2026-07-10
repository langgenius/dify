import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import * as jestDomMatchers from '@testing-library/jest-dom/matchers'
import { act, cleanup } from '@testing-library/react'
import { getDefaultStore } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
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
vi.mock('foxact/use-clipboard', () => ({
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

const testAccountProfileQueryKey = [
  ['console', 'account', 'profile', 'get'],
  { type: 'query' },
] as const

const testSystemFeaturesQueryKey = [
  ['console', 'systemFeatures', 'get'],
  { type: 'query' },
] as const

const testAccountProfile = {
  profile: {
    id: 'user-1',
    name: 'Test User',
    email: 'test@dify.ai',
    avatar: '',
    avatar_url: null,
    is_password_set: false,
    timezone: 'UTC',
  },
  meta: {
    currentVersion: null,
    currentEnv: null,
  },
} satisfies {
  profile: GetAccountProfileResponse
  meta: {
    currentVersion: string | null
    currentEnv: string | null
  }
}

const testSystemFeatures = {
  enable_app_deploy: false,
  sso_enforced_for_signin: false,
  sso_enforced_for_signin_protocol: '',
  enable_marketplace: false,
  enable_email_code_login: false,
  enable_email_password_login: true,
  enable_social_oauth_login: false,
  enable_collaboration_mode: true,
  is_allow_create_workspace: false,
  is_allow_register: false,
  is_email_setup: false,
  enable_change_email: true,
  max_plugin_package_size: 15728640,
  license: {
    status: 'none',
    expired_at: '',
    workspaces: {
      enabled: false,
      size: 0,
      limit: 0,
    },
  },
  branding: {
    enabled: false,
    login_page_logo: '',
    workspace_logo: '',
    favicon: '',
    application_title: '',
  },
  webapp_auth: {
    enabled: false,
    allow_sso: false,
    sso_config: {
      protocol: '',
    },
    allow_email_code_login: false,
    allow_email_password_login: false,
  },
  plugin_installation_permission: {
    plugin_installation_scope: 'all',
    restrict_to_marketplace_only: false,
  },
  plugin_manager: {
    enabled: false,
  },
  rbac_enabled: false,
  enable_creators_platform: false,
  enable_trial_app: false,
  enable_explore_banner: false,
  enable_learn_app: true,
  enable_step_by_step_tour: false,
} satisfies GetSystemFeaturesResponse

const seedResolvedAppContextQueries = () => {
  const queryClient = getDefaultStore().get(queryClientAtom)

  queryClient.setQueryData(testAccountProfileQueryKey, testAccountProfile)
  queryClient.setQueryData(testSystemFeaturesQueryKey, testSystemFeatures)
}

beforeEach(() => {
  vi.clearAllMocks()
  seedResolvedAppContextQueries()
  mockLocalStorage = createMockLocalStorage()
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockLocalStorage,
    writable: true,
    configurable: true,
  })
})
