import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { toast } from '@/app/notifications'
import { createHttpError } from '@/service/http-error'
import {
  fetchBundleInfoFromMarketPlace,
  fetchManifestFromMarketPlace,
  fetchPluginInfoFromMarketPlace,
} from '@/service/plugins'
import { useInstallFromMarketplaceQuery } from '../use-install-from-marketplace-query'

vi.mock('@/service/plugins', () => ({
  fetchBundleInfoFromMarketPlace: vi.fn(),
  fetchManifestFromMarketPlace: vi.fn(),
  fetchPluginInfoFromMarketPlace: vi.fn(),
}))

const marketplaceError = (message: string) =>
  createHttpError({ status: 503, statusText: '', headers: new Headers() }, { message })

const renderInstallQuery = (searchParams: string) =>
  renderHook(() => useInstallFromMarketplaceQuery({ canInstallPlugin: true }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <NuqsTestingAdapter searchParams={searchParams}>{children}</NuqsTestingAdapter>
    ),
  })

describe('useInstallFromMarketplaceQuery', () => {
  it('reports a plugin deep link whose marketplace lookup fails', async () => {
    const errorToast = vi.spyOn(toast, 'error')
    vi.mocked(fetchPluginInfoFromMarketPlace).mockRejectedValue(
      marketplaceError('Plugin not found'),
    )

    const { result } = renderInstallQuery(
      `?package-ids=${encodeURIComponent(JSON.stringify(['langgenius/openai']))}`,
    )

    await waitFor(() => expect(errorToast).toHaveBeenCalledExactlyOnceWith('Plugin not found'))
    expect(fetchManifestFromMarketPlace).not.toHaveBeenCalled()
    expect(result.current.isShowInstallFromMarketplace).toBe(false)
  })

  it('reports a bundle deep link whose marketplace lookup fails', async () => {
    const errorToast = vi.spyOn(toast, 'error')
    vi.mocked(fetchBundleInfoFromMarketPlace).mockRejectedValue(
      marketplaceError('Bundle not found'),
    )

    const { result } = renderInstallQuery(
      `?bundle-info=${encodeURIComponent(
        JSON.stringify({ org: 'langgenius', name: 'starter', version: '1.0.0' }),
      )}`,
    )

    await waitFor(() => expect(errorToast).toHaveBeenCalledExactlyOnceWith('Bundle not found'))
    expect(result.current.isShowInstallFromMarketplace).toBe(false)
  })
})
