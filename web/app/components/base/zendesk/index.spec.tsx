import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Zendesk from './index'

// Shared state for mocks
let mockIsCeEdition = false
let mockZendeskWidgetKey: string | undefined = 'test-key'
let mockIsProd = false
let mockNonce: string | null = 'test-nonce'

// Mock react's memo to just return the function
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    memo: vi.fn(fn => fn),
  }
})

// Mock config
vi.mock('@/config', () => ({
  get IS_CE_EDITION() { return mockIsCeEdition },
  get ZENDESK_WIDGET_KEY() { return mockZendeskWidgetKey },
  get IS_PROD() { return mockIsProd },
}))

// Mock next/headers
vi.mock('next/headers', () => ({
  headers: vi.fn(() => ({
    get: vi.fn((name: string) => {
      if (name === 'x-nonce')
        return mockNonce
      return null
    }),
  })),
}))

// Mock next/script
type ScriptProps = {
  'children'?: ReactNode
  'id'?: string
  'src'?: string
  'nonce'?: string
  'data-testid'?: string
}
vi.mock('next/script', () => ({
  __esModule: true,
  default: vi.fn(({ children, id, src, nonce, 'data-testid': testId }: ScriptProps) => (
    <div data-testid={testId} id={id} data-src={src} data-nonce={nonce}>
      {children}
    </div>
  )),
}))

describe('Zendesk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCeEdition = false
    mockZendeskWidgetKey = 'test-key'
    mockIsProd = false
    mockNonce = 'test-nonce'
  })

  // Helper to call the async component
  const renderZendesk = async () => {
    const Component = Zendesk as unknown as () => Promise<ReactNode>
    return await Component()
  }

  it('should render nothing when IS_CE_EDITION is true', async () => {
    mockIsCeEdition = true
    const result = await renderZendesk()
    expect(result).toBeNull()
  })

  it('should render nothing when ZENDESK_WIDGET_KEY is missing', async () => {
    mockZendeskWidgetKey = undefined
    const result = await renderZendesk()
    expect(result).toBeNull()
  })

  it('should render scripts correctly in non-production environment', async () => {
    mockIsProd = false
    const result = await renderZendesk()
    render(result as React.ReactElement) // result is ReactNode, which render accepts but types might be picky

    const snippet = screen.getByTestId('ze-snippet')
    expect(snippet).toBeInTheDocument()
    expect(snippet).toHaveAttribute('id', 'ze-snippet')
    expect(snippet).toHaveAttribute('data-src', 'https://static.zdassets.com/ekr/snippet.js?key=test-key')
    expect(snippet).toHaveAttribute('data-nonce', '')

    const init = screen.getByTestId('ze-init')
    expect(init).toBeInTheDocument()
    expect(init).toHaveAttribute('id', 'ze-init')
    expect(init).toHaveTextContent('window.zE(\'messenger\', \'hide\')')
    expect(init).toHaveAttribute('data-nonce', '')
  })

  it('should render scripts with nonce in production environment', async () => {
    mockIsProd = true
    mockNonce = 'prod-nonce'
    const result = await renderZendesk()
    render(result as React.ReactElement)

    const snippet = screen.getByTestId('ze-snippet')
    expect(snippet).toHaveAttribute('data-nonce', 'prod-nonce')

    const init = screen.getByTestId('ze-init')
    expect(init).toHaveAttribute('data-nonce', 'prod-nonce')
  })

  it('should render scripts with empty nonce in production when header is missing', async () => {
    mockIsProd = true
    mockNonce = null
    const result = await renderZendesk()
    render(result as React.ReactElement)

    const snippet = screen.getByTestId('ze-snippet')
    expect(snippet).toHaveAttribute('data-nonce', '')

    const init = screen.getByTestId('ze-init')
    expect(init).toHaveAttribute('data-nonce', '')
  })
})
