/**
 * Integration test: Partner Stack Flow
 *
 * Tests the PartnerStack integration:
 *   PartnerStack component → usePSInfo hook → cookie management → bind API call
 *
 * Covers URL param reading, cookie persistence, API bind on mount,
 * cookie cleanup after successful bind, and error handling for 400 status.
 */
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import Cookies from 'js-cookie'
import * as React from 'react'
import usePSInfo from '@/app/components/billing/partner-stack/use-ps-info'
import { PARTNER_STACK_CONFIG } from '@/config'

// ─── Mock state ──────────────────────────────────────────────────────────────
let mockSearchParams = new URLSearchParams()
const mockMutateAsync = vi.fn()

// ─── Module mocks ────────────────────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
}))

vi.mock('@/service/use-billing', () => ({
  useBindPartnerStackInfo: () => ({
    mutateAsync: mockMutateAsync,
  }),
  useBillingUrl: () => ({
    data: '',
    isFetching: false,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    IS_CLOUD_EDITION: true,
    PARTNER_STACK_CONFIG: {
      cookieName: 'partner_stack_info',
      saveCookieDays: 90,
    },
  }
})

// ─── Cookie helpers ──────────────────────────────────────────────────────────
const getCookieData = () => {
  const raw = Cookies.get(PARTNER_STACK_CONFIG.cookieName)
  if (!raw)
    return null
  try {
    return JSON.parse(raw)
  }
  catch {
    return null
  }
}

const setCookieData = (data: Record<string, string>) => {
  Cookies.set(PARTNER_STACK_CONFIG.cookieName, JSON.stringify(data))
}

const clearCookie = () => {
  Cookies.remove(PARTNER_STACK_CONFIG.cookieName)
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('Partner Stack Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
    clearCookie()
    mockSearchParams = new URLSearchParams()
    mockMutateAsync.mockResolvedValue({})
  })

  // ─── 1. URL Param Reading ───────────────────────────────────────────────
  describe('URL param reading', () => {
    it('should read ps_partner_key and ps_xid from URL search params', () => {
      mockSearchParams = new URLSearchParams({
        ps_partner_key: 'partner-123',
        ps_xid: 'click-456',
      })

      const { result } = renderHook(() => usePSInfo())

      expect(result.current.psPartnerKey).toBe('partner-123')
      expect(result.current.psClickId).toBe('click-456')
    })

    it('should fall back to cookie when URL params are not present', () => {
      setCookieData({ partnerKey: 'cookie-partner', clickId: 'cookie-click' })

      const { result } = renderHook(() => usePSInfo())

      expect(result.current.psPartnerKey).toBe('cookie-partner')
      expect(result.current.psClickId).toBe('cookie-click')
    })

    it('should prefer URL params over cookie values', () => {
      setCookieData({ partnerKey: 'cookie-partner', clickId: 'cookie-click' })
      mockSearchParams = new URLSearchParams({
        ps_partner_key: 'url-partner',
        ps_xid: 'url-click',
      })

      const { result } = renderHook(() => usePSInfo())

      expect(result.current.psPartnerKey).toBe('url-partner')
      expect(result.current.psClickId).toBe('url-click')
    })

    it('should return null for both values when no params and no cookie', () => {
      const { result } = renderHook(() => usePSInfo())

      expect(result.current.psPartnerKey).toBeUndefined()
      expect(result.current.psClickId).toBeUndefined()
    })
  })

  // ─── 2. Cookie Persistence (saveOrUpdate) ───────────────────────────────
  describe('Cookie persistence via saveOrUpdate', () => {
    it('should save PS info to cookie when URL params provide new values', () => {
      mockSearchParams = new URLSearchParams({
        ps_partner_key: 'new-partner',
        ps_xid: 'new-click',
      })

      const { result } = renderHook(() => usePSInfo())
      act(() => result.current.saveOrUpdate())

      const cookieData = getCookieData()
      expect(cookieData).toEqual({
        partnerKey: 'new-partner',
        clickId: 'new-click',
      })
    })

    it('should not update cookie when values have not changed', () => {
      setCookieData({ partnerKey: 'same-partner', clickId: 'same-click' })
      mockSearchParams = new URLSearchParams({
        ps_partner_key: 'same-partner',
        ps_xid: 'same-click',
      })

      const cookieSetSpy = vi.spyOn(Cookies, 'set')
      const { result } = renderHook(() => usePSInfo())
      act(() => result.current.saveOrUpdate())

      // Should not call set because values haven't changed
      expect(cookieSetSpy).not.toHaveBeenCalled()
      cookieSetSpy.mockRestore()
    })

    it('should not save to cookie when partner key is missing', () => {
      mockSearchParams = new URLSearchParams({
        ps_xid: 'click-only',
      })

      const cookieSetSpy = vi.spyOn(Cookies, 'set')
      const { result } = renderHook(() => usePSInfo())
      act(() => result.current.saveOrUpdate())

      expect(cookieSetSpy).not.toHaveBeenCalled()
      cookieSetSpy.mockRestore()
    })

    it('should not save to cookie when click ID is missing', () => {
      mockSearchParams = new URLSearchParams({
        ps_partner_key: 'partner-only',
      })

      const cookieSetSpy = vi.spyOn(Cookies, 'set')
      const { result } = renderHook(() => usePSInfo())
      act(() => result.current.saveOrUpdate())

      expect(cookieSetSpy).not.toHaveBeenCalled()
      cookieSetSpy.mockRestore()
    })
  })

  // ─── 3. Bind API Flow ──────────────────────────────────────────────────
  describe('Bind API flow', () => {
    it('should call mutateAsync with partnerKey and clickId on bind', async () => {
      mockSearchParams = new URLSearchParams({
        ps_partner_key: 'bind-partner',
        ps_xid: 'bind-click',
      })

      const { result } = renderHook(() => usePSInfo())
      await act(async () => {
        await result.current.bind()
      })

      expect(mockMutateAsync).toHaveBeenCalledWith({
        partnerKey: 'bind-partner',
        clickId: 'bind-click',
      })
    })

    it('should remove cookie after successful bind', async () => {
      setCookieData({ partnerKey: 'rm-partner', clickId: 'rm-click' })
      mockSearchParams = new URLSearchParams({
        ps_partner_key: 'rm-partner',
        ps_xid: 'rm-click',
      })

      const { result } = renderHook(() => usePSInfo())
      await act(async () => {
        await result.current.bind()
      })

      // Cookie should be removed after successful bind
      expect(Cookies.get(PARTNER_STACK_CONFIG.cookieName)).toBeUndefined()
    })

    it('should remove cookie on 400 error (already bound)', async () => {
      mockMutateAsync.mockRejectedValue({ status: 400 })
      setCookieData({ partnerKey: 'err-partner', clickId: 'err-click' })
      mockSearchParams = new URLSearchParams({
        ps_partner_key: 'err-partner',
        ps_xid: 'err-click',
      })

      const { result } = renderHook(() => usePSInfo())
      await act(async () => {
        await result.current.bind()
      })

      // Cookie should be removed even on 400
      expect(Cookies.get(PARTNER_STACK_CONFIG.cookieName)).toBeUndefined()
    })

    it('should not remove cookie on non-400 errors', async () => {
      mockMutateAsync.mockRejectedValue({ status: 500 })
      setCookieData({ partnerKey: 'keep-partner', clickId: 'keep-click' })
      mockSearchParams = new URLSearchParams({
        ps_partner_key: 'keep-partner',
        ps_xid: 'keep-click',
      })

      const { result } = renderHook(() => usePSInfo())
      await act(async () => {
        await result.current.bind()
      })

      // Cookie should still exist for non-400 errors
      const cookieData = getCookieData()
      expect(cookieData).toBeTruthy()
    })

    it('should not call bind when partner key is missing', async () => {
      mockSearchParams = new URLSearchParams({
        ps_xid: 'click-only',
      })

      const { result } = renderHook(() => usePSInfo())
      await act(async () => {
        await result.current.bind()
      })

      expect(mockMutateAsync).not.toHaveBeenCalled()
    })

    it('should not call bind a second time (idempotency)', async () => {
      mockSearchParams = new URLSearchParams({
        ps_partner_key: 'partner-once',
        ps_xid: 'click-once',
      })

      const { result } = renderHook(() => usePSInfo())

      // First bind
      await act(async () => {
        await result.current.bind()
      })
      expect(mockMutateAsync).toHaveBeenCalledTimes(1)

      // Second bind should be skipped (hasBind = true)
      await act(async () => {
        await result.current.bind()
      })
      expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    })
  })

  // ─── 4. PartnerStack Component Mount ────────────────────────────────────
  describe('PartnerStack component mount behavior', () => {
    it('should call saveOrUpdate and bind on mount when IS_CLOUD_EDITION is true', async () => {
      mockSearchParams = new URLSearchParams({
        ps_partner_key: 'mount-partner',
        ps_xid: 'mount-click',
      })

      // Use lazy import so the mocks are applied
      const { default: PartnerStack } = await import('@/app/components/billing/partner-stack')

      render(<PartnerStack />)

      // The component calls saveOrUpdate and bind in useEffect
      await waitFor(() => {
        // Bind should have been called
        expect(mockMutateAsync).toHaveBeenCalledWith({
          partnerKey: 'mount-partner',
          clickId: 'mount-click',
        })
      })

      // Cookie should have been saved (saveOrUpdate was called before bind)
      // After bind succeeds, cookie is removed
      expect(Cookies.get(PARTNER_STACK_CONFIG.cookieName)).toBeUndefined()
    })

    it('should render nothing (return null)', async () => {
      const { default: PartnerStack } = await import('@/app/components/billing/partner-stack')

      const { container } = render(<PartnerStack />)

      expect(container.innerHTML).toBe('')
    })
  })
})
