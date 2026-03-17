import type { ReactElement, ReactNode } from 'react'
import { render } from '@testing-library/react'

type HeaderValueMap = Record<string, string | null>

const { envState, mockHeaders, mockHeadersGet, headerState } = vi.hoisted(() => ({
  envState: {
    basePath: '',
  },
  mockHeaders: vi.fn(),
  mockHeadersGet: vi.fn(),
  headerState: {} as HeaderValueMap,
}))

vi.mock('@/env', () => ({
  env: {
    get NEXT_PUBLIC_BASE_PATH() {
      return envState.basePath
    },
  },
}))

vi.mock('next/headers', () => ({
  headers: mockHeaders,
}))

vi.mock('react/jsx-dev-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react/jsx-dev-runtime')>()
  const runtime = await import('react/jsx-runtime')
  return {
    ...actual,
    jsxDEV: actual.jsxDEV ?? runtime.jsx,
  }
})

const renderImportMap = async () => {
  const mod = await import('./import-map')
  const renderer = mod.default as unknown as () => Promise<ReactNode>
  const element = await renderer()
  render(element as ReactElement)
  const script = document.querySelector('script[data-modern-monaco-importmap]') as HTMLScriptElement | null
  return {
    importMap: JSON.parse(script?.textContent ?? '{}') as { imports?: Record<string, string> },
    script,
  }
}

describe('MonacoImportMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.unstubAllEnvs()

    envState.basePath = ''
    vi.stubEnv('NODE_ENV', 'test')

    for (const key of Object.keys(headerState))
      delete headerState[key]

    mockHeadersGet.mockImplementation((name: string) => headerState[name] ?? null)
    mockHeaders.mockResolvedValue({
      get: mockHeadersGet,
    })
  })

  describe('Rendering', () => {
    it('should render absolute import URLs with nonce when forwarded headers are present in production', async () => {
      envState.basePath = '/console'
      vi.stubEnv('NODE_ENV', 'production')
      headerState['x-forwarded-proto'] = 'https'
      headerState['x-forwarded-host'] = 'proxy.example.com'
      headerState.host = 'internal.example.com'
      headerState['x-nonce'] = 'nonce-123'

      const { script, importMap } = await renderImportMap()

      expect(script).toBeInTheDocument()
      expect(script).toHaveAttribute('type', 'importmap')
      expect(script).toHaveAttribute('nonce', 'nonce-123')
      expect(importMap.imports).toEqual({
        'modern-monaco/editor-core': 'https://proxy.example.com/console/hoisted-modern-monaco/modern-monaco/editor-core.mjs',
        'modern-monaco/lsp': 'https://proxy.example.com/console/hoisted-modern-monaco/modern-monaco/lsp/index.mjs',
      })
      expect(mockHeadersGet).toHaveBeenCalledWith('x-forwarded-proto')
      expect(mockHeadersGet).toHaveBeenCalledWith('x-forwarded-host')
      expect(mockHeadersGet).toHaveBeenCalledWith('x-nonce')
    })
  })

  describe('Props', () => {
    it('should fall back to host and default http protocol when forwarded headers are missing', async () => {
      headerState.host = 'app.example.com'

      const { script, importMap } = await renderImportMap()

      expect(script).toBeInTheDocument()
      expect(script).not.toHaveAttribute('nonce')
      expect(importMap.imports).toEqual({
        'modern-monaco/editor-core': 'http://app.example.com/hoisted-modern-monaco/modern-monaco/editor-core.mjs',
        'modern-monaco/lsp': 'http://app.example.com/hoisted-modern-monaco/modern-monaco/lsp/index.mjs',
      })
      expect(mockHeadersGet).toHaveBeenCalledWith('host')
      expect(mockHeadersGet).not.toHaveBeenCalledWith('x-nonce')
    })
  })

  describe('Edge Cases', () => {
    it('should keep relative import URLs and omit nonce when no request origin is available', async () => {
      envState.basePath = '/base'

      const { script, importMap } = await renderImportMap()

      expect(script).toBeInTheDocument()
      expect(script).not.toHaveAttribute('nonce')
      expect(importMap.imports).toEqual({
        'modern-monaco/editor-core': '/base/hoisted-modern-monaco/modern-monaco/editor-core.mjs',
        'modern-monaco/lsp': '/base/hoisted-modern-monaco/modern-monaco/lsp/index.mjs',
      })
      expect(mockHeadersGet).toHaveBeenCalledWith('host')
      expect(mockHeadersGet).not.toHaveBeenCalledWith('x-nonce')
    })

    it('should omit nonce when production request is missing the nonce header', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      headerState.host = 'prod.example.com'

      const { script } = await renderImportMap()

      expect(script).toBeInTheDocument()
      expect(script).not.toHaveAttribute('nonce')
      expect(mockHeadersGet).toHaveBeenCalledWith('x-nonce')
    })
  })
})
