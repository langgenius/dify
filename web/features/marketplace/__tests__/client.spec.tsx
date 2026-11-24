import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { useMarketplace } from '../client'
import { marketplaceLinks } from '../links'

const renderUseMarketplace = (enableMarketplace: boolean) => {
  const queryClient = new QueryClient()
  queryClient.setQueryData(
    systemFeaturesQueryOptions().queryKey,
    createSystemFeaturesFixture({ enable_marketplace: enableMarketplace }),
  )

  return renderHook(() => useMarketplace(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
}

describe('useMarketplace', () => {
  it('returns the Marketplace links when the deployment enables Marketplace', () => {
    expect(renderUseMarketplace(true).result.current).toBe(marketplaceLinks)
  })

  it('returns null when the deployment disables Marketplace', () => {
    expect(renderUseMarketplace(false).result.current).toBeNull()
  })
})
