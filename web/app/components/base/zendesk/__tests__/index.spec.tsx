import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { ReactNode } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import Zendesk from '../index'

// Shared state for mocks
let mockDeploymentEdition: DeploymentEdition = 'CLOUD'
let mockZendeskWidgetKey: string | undefined = 'test-key'
let mockIsProd = false
let mockNonce: string | null = 'test-nonce'
let queryClient: QueryClient
const systemFeaturesQueryKey = ['console', 'system-features']
const getSystemFeatures = vi.fn()
const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  scriptProps: vi.fn(),
}))

// Mock react's memo to just return the function
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    memo: vi.fn((fn) => fn),
  }
})

vi.mock('@/config', () => ({
  get ZENDESK_WIDGET_KEY() {
    return mockZendeskWidgetKey
  },
  get IS_PROD() {
    return mockIsProd
  },
}))

vi.mock('@/features/system-features/server', () => ({
  prefetchSystemFeatures: async () => {
    const queryOptions = {
      queryKey: systemFeaturesQueryKey,
      queryFn: getSystemFeatures,
      retry: false,
    }
    await queryClient.prefetchQuery(queryOptions)
    return queryClient.getQueryData(queryOptions.queryKey)
  },
}))

// Mock next/headers
vi.mock('@/next/headers', () => ({
  headers: mocks.headers,
}))

type ZendeskScriptProps = {
  nonce?: string
  widgetKey: string
}
vi.mock('../script', () => ({
  ZendeskScript: (props: ZendeskScriptProps) => {
    mocks.scriptProps(props)
    return <div data-testid="zendesk-runtime" data-nonce={props.nonce} />
  },
}))

describe('Zendesk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeploymentEdition = 'CLOUD'
    mockZendeskWidgetKey = 'test-key'
    mockIsProd = false
    mockNonce = 'test-nonce'
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    getSystemFeatures.mockImplementation(async () => ({
      deployment_edition: mockDeploymentEdition,
    }))
    mocks.headers.mockImplementation(async () => {
      const requestHeaders = new Headers()
      if (mockNonce !== null) requestHeaders.set('x-nonce', mockNonce)
      return requestHeaders
    })
  })

  // Helper to call the async component
  const renderZendesk = async () => {
    const Component = Zendesk as unknown as () => Promise<ReactNode>
    return await Component()
  }

  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'should render nothing when deployment edition is %s',
    async (deploymentEdition) => {
      mockDeploymentEdition = deploymentEdition
      const result = await renderZendesk()
      expect(result).toBeNull()
    },
  )

  it('should render nothing when ZENDESK_WIDGET_KEY is missing', async () => {
    mockZendeskWidgetKey = undefined
    const result = await renderZendesk()
    expect(result).toBeNull()
    expect(mocks.headers).not.toHaveBeenCalled()
    expect(getSystemFeatures).not.toHaveBeenCalled()
  })

  it('should render nothing when System Features is unavailable', async () => {
    getSystemFeatures.mockRejectedValue(new Error('system features unavailable'))

    const result = await renderZendesk()

    expect(result).toBeNull()
  })

  it('should mount the runtime without a nonce in non-production', async () => {
    mockIsProd = false
    const result = await renderZendesk()
    render(result as React.ReactElement) // result is ReactNode, which render accepts but types might be picky

    expect(screen.getByTestId('zendesk-runtime')).toHaveAttribute('data-nonce', '')
    expect(mocks.scriptProps).toHaveBeenCalledWith({ nonce: '', widgetKey: 'test-key' })
  })

  it('should render scripts with nonce in production environment', async () => {
    mockIsProd = true
    mockNonce = 'prod-nonce'
    const result = await renderZendesk()
    render(result as React.ReactElement)

    expect(screen.getByTestId('zendesk-runtime')).toHaveAttribute('data-nonce', 'prod-nonce')
    expect(mocks.scriptProps).toHaveBeenCalledWith({ nonce: 'prod-nonce', widgetKey: 'test-key' })
  })

  it('should render scripts with empty nonce in production when header is missing', async () => {
    mockIsProd = true
    mockNonce = null
    const result = await renderZendesk()
    render(result as React.ReactElement)

    expect(screen.getByTestId('zendesk-runtime')).toHaveAttribute('data-nonce', '')
  })
})
