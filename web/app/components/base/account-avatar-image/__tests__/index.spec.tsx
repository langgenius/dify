import { Avatar, AvatarFallback } from '@langgenius/dify-ui/avatar'
import { act, render, waitFor } from '@testing-library/react'
import { AccountAvatarImage } from '..'

const mocks = vi.hoisted(() => ({
  refreshAccessTokenOrReLogin: vi.fn(),
}))

vi.mock('@/config', () => ({ API_PREFIX: '/console/api' }))
vi.mock('@/service/refresh-token', () => ({
  refreshAccessTokenOrReLogin: mocks.refreshAccessTokenOrReLogin,
}))

const accountId = '11111111-1111-1111-1111-111111111111'
const fileId = '22222222-2222-2222-2222-222222222222'
const stableAvatar = `/console/api/accounts/${accountId}/avatars/${fileId}`

class ControlledImage {
  complete = false
  naturalWidth = 0
  onerror: ((event: Event) => void) | null = null
  onload: ((event: Event) => void) | null = null
  referrerPolicy = ''
  crossOrigin: string | null = null
  sizes = ''
  src = ''
  srcset = ''

  fail() {
    this.onerror?.(new Event('error'))
  }
}

const renderAvatar = (src: string) => {
  const images: ControlledImage[] = []
  class MockImage extends ControlledImage {
    constructor() {
      super()
      images.push(this)
    }
  }
  vi.spyOn(window, 'Image').mockImplementation(MockImage as unknown as typeof window.Image)
  render(
    <Avatar>
      <AvatarFallback>A</AvatarFallback>
      <AccountAvatarImage src={src} alt="" />
    </Avatar>,
  )
  return images
}

describe('AccountAvatarImage', () => {
  beforeEach(() => {
    mocks.refreshAccessTokenOrReLogin.mockReset().mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('refreshes an expired Console session and retries the same stable avatar once', async () => {
    const fetchMock = vi
      .mocked(globalThis.fetch)
      .mockResolvedValue(new Response(null, { status: 401 }))
    const images = renderAvatar(stableAvatar)
    expect(fetchMock).not.toHaveBeenCalled()

    await act(async () => {
      images[0]!.fail()
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => expect(images).toHaveLength(2))
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(stableAvatar, {
      method: 'HEAD',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'manual',
      signal: expect.any(AbortSignal),
    })
    expect(mocks.refreshAccessTokenOrReLogin).toHaveBeenCalledOnce()
    expect(images[1]!.src).toBe(images[0]!.src)

    act(() => images[1]!.fail())
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mocks.refreshAccessTokenOrReLogin).toHaveBeenCalledOnce()
  })

  it('retries without refreshing when another request already renewed the session', async () => {
    const fetchMock = vi
      .mocked(globalThis.fetch)
      .mockResolvedValue(new Response(null, { status: 200 }))
    const images = renderAvatar(stableAvatar)

    await act(async () => {
      images[0]!.fail()
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => expect(images).toHaveLength(2))
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mocks.refreshAccessTokenOrReLogin).not.toHaveBeenCalled()
    expect(images[1]!.src).toBe(images[0]!.src)
  })

  it.each([
    ['a missing stable avatar', () => Promise.resolve(new Response(null, { status: 404 }))],
    ['a failed probe', () => Promise.reject(new TypeError('network error'))],
  ])('does not refresh or retry after %s', async (_name, probe) => {
    const fetchMock = vi.mocked(globalThis.fetch).mockImplementation(probe)
    const images = renderAvatar(stableAvatar)

    act(() => images[0]!.fail())

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await Promise.resolve()
    expect(mocks.refreshAccessTokenOrReLogin).not.toHaveBeenCalled()
    expect(images).toHaveLength(1)
  })

  it.each([
    ['an external avatar', 'https://images.example.com/user.png'],
    ['a stable-path lookalike', `${stableAvatar}/extra`],
    ['a stable URL with query parameters', `${stableAvatar}?signature=legacy`],
  ])('does not probe %s after it fails to load', async (_name, src) => {
    const fetchMock = vi.mocked(globalThis.fetch)
    const images = renderAvatar(src)

    act(() => images[0]!.fail())
    await Promise.resolve()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.refreshAccessTokenOrReLogin).not.toHaveBeenCalled()
  })
})
