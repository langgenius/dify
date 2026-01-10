import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { PARTNER_STACK_CONFIG } from '@/config'
import usePSInfo from './use-ps-info'

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

const renderWithAdapter = (searchParams = '') => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NuqsTestingAdapter searchParams={searchParams}>
      {children}
    </NuqsTestingAdapter>
  )
  return renderHook(() => usePSInfo(), { wrapper })
}

describe('usePSInfo', () => {
  const originalLocationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location')

  beforeAll(() => {
    Object.defineProperty(globalThis, 'location', {
      value: { hostname: 'cloud.dify.ai' },
      configurable: true,
    })
  })

  beforeEach(() => {
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
    const { result } = renderWithAdapter('?ps_partner_key=new-partner&ps_xid=new-click')

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
    const { get } = ensureCookieMocks()
    get.mockReturnValue(JSON.stringify({
      partnerKey: 'existing',
      clickId: 'existing-click',
    }))

    const { result } = renderWithAdapter('?ps_partner_key=existing&ps_xid=existing-click')

    act(() => {
      result.current.saveOrUpdate()
    })

    const { set } = ensureCookieMocks()
    expect(set).not.toHaveBeenCalled()
  })

  it('binds partner info and clears cookie once', async () => {
    const { result } = renderWithAdapter('?ps_partner_key=bind-partner&ps_xid=bind-click')

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
    const { result } = renderWithAdapter('?ps_partner_key=bind-partner&ps_xid=bind-click')

    await act(async () => {
      await result.current.bind()
    })

    const { remove } = ensureCookieMocks()
    expect(remove).toHaveBeenCalledWith(PARTNER_STACK_CONFIG.cookieName, {
      path: '/',
      domain: '.dify.ai',
    })
  })
})
