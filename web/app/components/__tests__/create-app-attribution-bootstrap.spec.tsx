import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runCreateAppAttributionBootstrap } from '@/utils/create-app-tracking'

let mockIsProd = false
let mockNonce: string | null = 'test-nonce'

type BootstrapScriptProps = {
  id?: string
  strategy?: string
  nonce?: string
  children?: string
}

vi.mock('@/config', () => ({
  get IS_PROD() { return mockIsProd },
}))

vi.mock('@/next/headers', () => ({
  headers: vi.fn(() => ({
    get: vi.fn((name: string) => {
      if (name === 'x-nonce')
        return mockNonce
      return null
    }),
  })),
}))

const loadComponent = async () => {
  const mod = await import('../create-app-attribution-bootstrap')
  const rawExport = mod.default as unknown
  const renderer: (() => Promise<ReactNode>) | undefined
    = typeof rawExport === 'function' ? rawExport as () => Promise<ReactNode> : (rawExport as { type?: () => Promise<ReactNode> }).type

  if (!renderer)
    throw new Error('CreateAppAttributionBootstrap component is not callable in tests')

  return renderer
}

const runBootstrapScript = () => {
  runCreateAppAttributionBootstrap()
}

describe('CreateAppAttributionBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockIsProd = false
    mockNonce = 'test-nonce'
    window.sessionStorage.clear()
    window.history.replaceState({}, '', '/apps')
  })

  it('renders a beforeInteractive script element', async () => {
    const renderComponent = await loadComponent()
    const element = await renderComponent() as ReactElement<BootstrapScriptProps>

    expect(element).toBeTruthy()
    expect(element.props.id).toBe('create-app-attribution-bootstrap')
    expect(element.props.strategy).toBe('beforeInteractive')
    expect(element.props.children).toContain('window.sessionStorage.setItem')
  })

  it('uses the nonce header in production', async () => {
    mockIsProd = true
    mockNonce = 'prod-nonce'

    const renderComponent = await loadComponent()
    const element = await renderComponent() as ReactElement<BootstrapScriptProps>

    expect(element.props.nonce).toBe('prod-nonce')
  })

  it('stores external attribution and clears only attribution params from the url', () => {
    window.history.replaceState({}, '', '/apps?action=keep&utm_source=dify_blog&slug=get-started-with-dif#preview')

    runBootstrapScript()

    expect(window.sessionStorage.getItem('create_app_external_attribution')).toBe(JSON.stringify({
      utmSource: 'blog',
      utmCampaign: 'get-started-with-dif',
    }))
    expect(window.location.pathname).toBe('/apps')
    expect(window.location.search).toBe('?action=keep')
    expect(window.location.hash).toBe('#preview')
  })

  it('does nothing for invalid external sources', () => {
    window.history.replaceState({}, '', '/apps?action=keep&utm_source=internal&slug=ignored')

    runBootstrapScript()

    expect(window.sessionStorage.getItem('create_app_external_attribution')).toBeNull()
    expect(window.location.search).toBe('?action=keep&utm_source=internal&slug=ignored')
  })
})
