import { act, renderHook } from '@testing-library/react'
import { PARTNER_STACK_CONFIG } from '@/config'
import usePSInfo from '../use-ps-info'

let searchParamsValues: Record<string, string | null> = {}
const setSearchParams = (values: Record<string, string | null>) => {
  searchParamsValues = values
}

type PartnerStackGlobal = typeof globalThis & {
  __partnerStackCookieMocks?: {
    get: ReturnType<typeof vi.fn>
    set: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
  }
  __partnerStackMutateAsync?: ReturnType<typeof vi.fn>
}

function getPartnerStackGlobal(): PartnerStackGlobal {
  return globalThis as PartnerStackGlobal
}

const ensureCookieMocks = () => {
  const globals = getPartnerStackGlobal()
  if (!globals.__partnerStackCookieMocks)
    throw new Error('Cookie mocks not initialized')
  return globals.__partnerStackCookieMocks
}

const ensureMutateAsync = () => {
  const globals = getPartnerStackGlobal()
  if (!globals.__partnerStackMutateAsync)
    throw new Error('Mutate mock not initialized')
  return globals.__partnerStackMutateAsync
}

vi.mock('js-cookie', () => {
  const get = vi.fn()
  const set = vi.fn()
  const remove = vi.fn()
  const globals = getPartnerStackGlobal()
  globals.__partnerStackCookieMocks = { get, set, remove }
  const cookieApi = { get, set, remove }
  return {
    default: cookieApi,
    get,
    set,
    remove,
  }
})
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => searchParamsValues[key] ?? null,
  }),
}))
vi.mock('@/service/use-billing', () => {
  const mutateAsync = vi.fn()
  const globals = getPartnerStackGlobal()
  globals.__partnerStackMutateAsync = mutateAsync
  return {
    useBindPartnerStackInfo: () => ({
      mutateAsync,
    }),
  }
})

describe('usePSInfo', () => {
  const originalLocationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location')

  beforeAll(() => {
    Object.defineProperty(globalThis, 'location', {
      value: { hostname: 'cloud.dify.ai' },
      configurable: true,
    })
  })

  beforeEach(() => {
    setSearchParams({})
    const { get, set, remove } = ensureCookieMocks()
    get.mockReset()
    set.mockReset()
    remove.mockReset()
    const mutate = ensureMutateAsync()
    mutate.mockReset()
    mutate.mockResolvedValue(undefined)
    get.mockReturnValue('{}')
  })

  afterAll(() => {
    if (originalLocationDescriptor)
      Object.defineProperty(globalThis, 'location', originalLocationDescriptor)
  })

  it('saves partner info when query params change', () => {
    const { get, set } = ensureCookieMocks()
    get.mockReturnValue(JSON.stringify({ partnerKey: 'old', clickId: 'old-click' }))
    setSearchParams({
      ps_partner_key: 'new-partner',
      ps_xid: 'new-click',
    })

    const { result } = renderHook(() => usePSInfo())

    expect(result.current.psPartnerKey).toBe('new-partner')
    expect(result.current.psClickId).toBe('new-click')

    act(() => {
      result.current.saveOrUpdate()
    })

    expect(set).toHaveBeenCalledWith(
      PARTNER_STACK_CONFIG.cookieName,
      JSON.stringify({
        partnerKey: 'new-partner',
        clickId: 'new-click',
      }),
      {
        expires: PARTNER_STACK_CONFIG.saveCookieDays,
        path: '/',
        domain: '.dify.ai',
      },
    )
  })

  it('does not overwrite cookie when params do not change', () => {
    setSearchParams({
      ps_partner_key: 'existing',
      ps_xid: 'existing-click',
    })
    const { get } = ensureCookieMocks()
    get.mockReturnValue(JSON.stringify({
      partnerKey: 'existing',
      clickId: 'existing-click',
    }))

    const { result } = renderHook(() => usePSInfo())

    act(() => {
      result.current.saveOrUpdate()
    })

    const { set } = ensureCookieMocks()
    expect(set).not.toHaveBeenCalled()
  })

  it('binds partner info and clears cookie once', async () => {
    setSearchParams({
      ps_partner_key: 'bind-partner',
      ps_xid: 'bind-click',
    })

    const { result } = renderHook(() => usePSInfo())

    const mutate = ensureMutateAsync()
    const { remove } = ensureCookieMocks()
    await act(async () => {
      await result.current.bind()
    })

    expect(mutate).toHaveBeenCalledWith({
      partnerKey: 'bind-partner',
      clickId: 'bind-click',
    })
    expect(remove).toHaveBeenCalledWith(PARTNER_STACK_CONFIG.cookieName, {
      path: '/',
      domain: '.dify.ai',
    })

    await act(async () => {
      await result.current.bind()
    })

    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('still removes cookie when bind fails with status 400', async () => {
    const mutate = ensureMutateAsync()
    mutate.mockRejectedValueOnce({ status: 400 })
    setSearchParams({
      ps_partner_key: 'bind-partner',
      ps_xid: 'bind-click',
    })

    const { result } = renderHook(() => usePSInfo())

    await act(async () => {
      await result.current.bind()
    })

    const { remove } = ensureCookieMocks()
    expect(remove).toHaveBeenCalledWith(PARTNER_STACK_CONFIG.cookieName, {
      path: '/',
      domain: '.dify.ai',
    })
  })

  // Cookie parse failure: covers catch block (L14-16)
  it('should fall back to empty object when cookie contains invalid JSON', () => {
    const { get } = ensureCookieMocks()
    get.mockReturnValue('not-valid-json{{{')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    setSearchParams({
      ps_partner_key: 'from-url',
      ps_xid: 'click-url',
    })

    const { result } = renderHook(() => usePSInfo())

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to parse partner stack info from cookie:',
      expect.any(SyntaxError),
    )
    // Should still pick up values from search params
    expect(result.current.psPartnerKey).toBe('from-url')
    expect(result.current.psClickId).toBe('click-url')
    consoleSpy.mockRestore()
  })

  // No keys at all: covers saveOrUpdate early return (L30) and bind no-op (L45 false branch)
  it('should not save or bind when neither search params nor cookie have keys', () => {
    const { get, set } = ensureCookieMocks()
    get.mockReturnValue('{}')
    setSearchParams({})

    const { result } = renderHook(() => usePSInfo())

    expect(result.current.psPartnerKey).toBeUndefined()
    expect(result.current.psClickId).toBeUndefined()

    act(() => {
      result.current.saveOrUpdate()
    })
    expect(set).not.toHaveBeenCalled()
  })

  it('should not call mutateAsync when keys are missing during bind', async () => {
    const { get } = ensureCookieMocks()
    get.mockReturnValue('{}')
    setSearchParams({})

    const { result } = renderHook(() => usePSInfo())

    const mutate = ensureMutateAsync()
    await act(async () => {
      await result.current.bind()
    })

    expect(mutate).not.toHaveBeenCalled()
  })

  // Non-400 error: covers L55 false branch (shouldRemoveCookie stays false)
  it('should not remove cookie when bind fails with non-400 error', async () => {
    const mutate = ensureMutateAsync()
    mutate.mockRejectedValueOnce({ status: 500 })
    setSearchParams({
      ps_partner_key: 'bind-partner',
      ps_xid: 'bind-click',
    })

    const { result } = renderHook(() => usePSInfo())

    await act(async () => {
      await result.current.bind()
    })

    const { remove } = ensureCookieMocks()
    expect(remove).not.toHaveBeenCalled()
  })

  // Fallback to cookie values: covers L19-20 right side of || operator
  it('should use cookie values when search params are absent', () => {
    const { get } = ensureCookieMocks()
    get.mockReturnValue(JSON.stringify({
      partnerKey: 'cookie-partner',
      clickId: 'cookie-click',
    }))
    setSearchParams({})

    const { result } = renderHook(() => usePSInfo())

    expect(result.current.psPartnerKey).toBe('cookie-partner')
    expect(result.current.psClickId).toBe('cookie-click')
  })

  // Partial key missing: only partnerKey present, no clickId
  it('should not save when only one key is available', () => {
    const { get, set } = ensureCookieMocks()
    get.mockReturnValue('{}')
    setSearchParams({ ps_partner_key: 'partial-key' })

    const { result } = renderHook(() => usePSInfo())

    act(() => {
      result.current.saveOrUpdate()
    })

    expect(set).not.toHaveBeenCalled()
  })
})
