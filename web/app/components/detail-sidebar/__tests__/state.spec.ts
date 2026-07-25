import { createStore } from 'jotai'
import Cookies from 'js-cookie'
import { DETAIL_SIDEBAR_COOKIE_NAME } from '../preference'
import { detailSidebarModeAtom, initializeDetailSidebarModeAtom } from '../state'

describe('detailSidebarModeAtom', () => {
  beforeEach(() => {
    Cookies.remove(DETAIL_SIDEBAR_COOKIE_NAME, { path: '/' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('initializes the atom without writing the Cookie', () => {
    const store = createStore()
    const setCookie = vi.spyOn(Cookies, 'set')

    store.set(initializeDetailSidebarModeAtom, 'collapse')

    expect(store.get(detailSidebarModeAtom)).toBe('collapse')
    expect(setCookie).not.toHaveBeenCalled()
  })

  it('updates the atom first and persists the next value with the fixed attributes', () => {
    const store = createStore()
    const setCookie = vi.spyOn(Cookies, 'set').mockImplementation((_name, value) => {
      expect(store.get(detailSidebarModeAtom)).toBe(value)
      return undefined
    })

    store.set(detailSidebarModeAtom, (mode) => (mode === 'expand' ? 'collapse' : 'expand'))

    expect(store.get(detailSidebarModeAtom)).toBe('collapse')
    expect(setCookie).toHaveBeenCalledWith(DETAIL_SIDEBAR_COOKIE_NAME, 'collapse', {
      expires: 365,
      path: '/',
      sameSite: 'lax',
      secure: false,
    })
  })

  it('keeps the atom update when Cookie persistence throws', () => {
    const store = createStore()
    vi.spyOn(Cookies, 'set').mockImplementation(() => {
      throw new Error('Cookie access unavailable')
    })

    expect(() => store.set(detailSidebarModeAtom, 'collapse')).not.toThrow()
    expect(store.get(detailSidebarModeAtom)).toBe('collapse')
  })
})
