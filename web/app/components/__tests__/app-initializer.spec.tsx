import { render, screen, waitFor } from '@testing-library/react'
import { useQueryState } from 'nuqs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolvePostLoginRedirect } from '@/app/signin/utils/post-login-redirect'
import { usePathname, useRouter, useSearchParams } from '@/next/navigation'
import {
  clearCreateAppExternalAttributionSearchParams,
  extractExternalCreateAppAttribution,
  rememberCreateAppExternalAttribution,
} from '@/utils/create-app-tracking'
import { fetchSetupStatusWithCache } from '@/utils/setup-status'
import { AppInitializer } from '../app-initializer'

vi.mock('nuqs', () => ({
  parseAsBoolean: {
    withOptions: vi.fn(() => ({})),
  },
  useQueryState: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

vi.mock('@/utils/create-app-tracking', () => ({
  extractExternalCreateAppAttribution: vi.fn(),
  rememberCreateAppExternalAttribution: vi.fn(),
  clearCreateAppExternalAttributionSearchParams: vi.fn(),
}))

vi.mock('@/utils/setup-status', () => ({
  fetchSetupStatusWithCache: vi.fn(),
}))

vi.mock('@/app/signin/utils/post-login-redirect', () => ({
  resolvePostLoginRedirect: vi.fn(),
}))

vi.mock('@/utils/gtag', () => ({
  sendGAEvent: vi.fn(),
}))

vi.mock('../base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

const mockUseQueryState = vi.mocked(useQueryState)
const mockUsePathname = vi.mocked(usePathname)
const mockUseRouter = vi.mocked(useRouter)
const mockUseSearchParams = vi.mocked(useSearchParams)
const mockExtractExternalCreateAppAttribution = vi.mocked(extractExternalCreateAppAttribution)
const mockRememberCreateAppExternalAttribution = vi.mocked(rememberCreateAppExternalAttribution)
const mockClearCreateAppExternalAttributionSearchParams = vi.mocked(clearCreateAppExternalAttributionSearchParams)
const mockFetchSetupStatusWithCache = vi.mocked(fetchSetupStatusWithCache)
const mockResolvePostLoginRedirect = vi.mocked(resolvePostLoginRedirect)
const mockReplace = vi.fn()

describe('AppInitializer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePathname.mockReturnValue('/apps')
    mockUseRouter.mockReturnValue({ replace: mockReplace } as unknown as ReturnType<typeof useRouter>)
    mockUseQueryState.mockReturnValue([null, vi.fn()] as ReturnType<typeof useQueryState>)
    mockFetchSetupStatusWithCache.mockResolvedValue({ step: 'finished' })
    mockResolvePostLoginRedirect.mockReturnValue(null)
  })

  it('should remember and clear external attribution params when the current url contains them', async () => {
    const searchParams = new URLSearchParams('utm_source=linkedin&slug=agent-launch&action=keep')
    mockUseSearchParams.mockReturnValue(searchParams as unknown as ReturnType<typeof useSearchParams>)
    mockExtractExternalCreateAppAttribution.mockReturnValue({
      utmSource: 'linkedin',
      utmCampaign: 'agent-launch',
    })

    render(
      <AppInitializer>
        <div>ready</div>
      </AppInitializer>,
    )

    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument())

    expect(mockExtractExternalCreateAppAttribution).toHaveBeenCalledWith({
      searchParams,
      utmInfo: null,
    })
    expect(mockRememberCreateAppExternalAttribution).toHaveBeenCalledWith({ searchParams })
    expect(mockClearCreateAppExternalAttributionSearchParams).toHaveBeenCalledTimes(1)
  })

  it('should skip url cleanup when no external attribution is present', async () => {
    const searchParams = new URLSearchParams('action=keep')
    mockUseSearchParams.mockReturnValue(searchParams as unknown as ReturnType<typeof useSearchParams>)
    mockExtractExternalCreateAppAttribution.mockReturnValue(null)

    render(
      <AppInitializer>
        <div>ready</div>
      </AppInitializer>,
    )

    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument())

    expect(mockRememberCreateAppExternalAttribution).toHaveBeenCalledWith({ searchParams })
    expect(mockClearCreateAppExternalAttributionSearchParams).not.toHaveBeenCalled()
  })
})
