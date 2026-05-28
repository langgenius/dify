import { screen, waitFor } from '@testing-library/react'
import Cookies from 'js-cookie'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION,
  EDUCATION_VERIFYING_LOCALSTORAGE_ITEM,
} from '@/app/education-apply/constants'
import { resolvePostLoginRedirect } from '@/app/signin/utils/post-login-redirect'
import { usePathname, useRouter, useSearchParams } from '@/next/navigation'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { fetchSetupStatusWithCache } from '@/utils/setup-status'
import { AppInitializer } from '../app-initializer'

const { mockSendGAEvent, mockTrackEvent } = vi.hoisted(() => ({
  mockSendGAEvent: vi.fn(),
  mockTrackEvent: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

vi.mock('@/utils/setup-status', () => ({
  fetchSetupStatusWithCache: vi.fn(),
}))

vi.mock('@/app/signin/utils/post-login-redirect', () => ({
  resolvePostLoginRedirect: vi.fn(),
}))

vi.mock('@/utils/gtag', () => ({
  sendGAEvent: (...args: unknown[]) => mockSendGAEvent(...args),
}))

vi.mock('../base/amplitude', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

const mockUsePathname = vi.mocked(usePathname)
const mockUseRouter = vi.mocked(useRouter)
const mockUseSearchParams = vi.mocked(useSearchParams)
const mockFetchSetupStatusWithCache = vi.mocked(fetchSetupStatusWithCache)
const mockResolvePostLoginRedirect = vi.mocked(resolvePostLoginRedirect)
const mockReplace = vi.fn()

describe('AppInitializer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    window.localStorage.clear()
    window.sessionStorage.clear()
    Cookies.remove('utm_info')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockUsePathname.mockReturnValue('/apps')
    mockUseRouter.mockReturnValue({ replace: mockReplace } as unknown as ReturnType<typeof useRouter>)
    mockUseSearchParams.mockReturnValue(new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>)
    mockFetchSetupStatusWithCache.mockResolvedValue({ step: 'finished' })
    mockResolvePostLoginRedirect.mockReturnValue(null)
  })

  it('renders children after setup checks finish', async () => {
    renderWithNuqs(
      <AppInitializer>
        <div>ready</div>
      </AppInitializer>,
    )

    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument())

    expect(mockFetchSetupStatusWithCache).toHaveBeenCalledTimes(1)
    expect(mockReplace).not.toHaveBeenCalledWith('/signin')
  })

  it('redirects to install when setup status loading fails', async () => {
    mockFetchSetupStatusWithCache.mockRejectedValue(new Error('unauthorized'))

    renderWithNuqs(
      <AppInitializer>
        <div>ready</div>
      </AppInitializer>,
    )

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/install'))
    expect(screen.queryByText('ready')).not.toBeInTheDocument()
  })

  it('does not persist create app attribution from the url anymore', async () => {
    renderWithNuqs(
      <AppInitializer>
        <div>ready</div>
      </AppInitializer>,
    )

    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument())

    expect(window.sessionStorage.getItem('create_app_external_attribution')).toBeNull()
  })

  it('tracks oauth registration with utm info and clears the cookie', async () => {
    Cookies.set('utm_info', JSON.stringify({
      utm_source: 'linkedin',
      slug: 'agent-launch',
    }))

    renderWithNuqs(
      <AppInitializer>
        <div>ready</div>
      </AppInitializer>,
      { searchParams: 'oauth_new_user=true' },
    )

    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument())

    expect(mockTrackEvent).toHaveBeenCalledWith('user_registration_success_with_utm', {
      method: 'oauth',
      utm_source: 'linkedin',
      slug: 'agent-launch',
    })
    expect(mockSendGAEvent).toHaveBeenCalledWith('user_registration_success_with_utm', {
      method: 'oauth',
      utm_source: 'linkedin',
      slug: 'agent-launch',
    })
    expect(mockReplace).toHaveBeenCalledWith('/apps')
    expect(Cookies.get('utm_info')).toBeUndefined()
  })

  it('falls back to the base registration event when the oauth utm cookie is invalid', async () => {
    Cookies.set('utm_info', '{invalid-json')

    renderWithNuqs(
      <AppInitializer>
        <div>ready</div>
      </AppInitializer>,
      { searchParams: 'oauth_new_user=true' },
    )

    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument())

    expect(mockTrackEvent).toHaveBeenCalledWith('user_registration_success', {
      method: 'oauth',
    })
    expect(mockSendGAEvent).toHaveBeenCalledWith('user_registration_success', {
      method: 'oauth',
    })
    expect(console.error).toHaveBeenCalled()
    expect(Cookies.get('utm_info')).toBeUndefined()
  })

  it('stores the education verification flag in localStorage', async () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams(`action=${EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION}`) as unknown as ReturnType<typeof useSearchParams>,
    )

    renderWithNuqs(
      <AppInitializer>
        <div>ready</div>
      </AppInitializer>,
    )

    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument())

    expect(window.localStorage.getItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM)).toBe('yes')
  })

  it('redirects to the resolved post-login url when one exists', async () => {
    const mockLocationReplace = vi.fn()
    vi.stubGlobal('location', { ...window.location, replace: mockLocationReplace })
    mockResolvePostLoginRedirect.mockReturnValue('/explore')

    renderWithNuqs(
      <AppInitializer>
        <div>ready</div>
      </AppInitializer>,
    )

    await waitFor(() => expect(mockLocationReplace).toHaveBeenCalledWith('/explore'))
    expect(screen.queryByText('ready')).not.toBeInTheDocument()
  })

  it('redirects to signin when redirect resolution throws', async () => {
    mockResolvePostLoginRedirect.mockImplementation(() => {
      throw new Error('redirect resolution failed')
    })

    renderWithNuqs(
      <AppInitializer>
        <div>ready</div>
      </AppInitializer>,
    )

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/signin'))
    expect(screen.queryByText('ready')).not.toBeInTheDocument()
  })
})
