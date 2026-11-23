import type { AvatarImageProps } from '@langgenius/dify-ui/avatar'
import { Avatar, AvatarFallback } from '@langgenius/dify-ui/avatar'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { notifySessionRefreshed } from '@/service/session-refresh-events'
import { AccountAvatarImage } from '..'

const sessionRefresh = vi.hoisted(() => {
  let revision = 0
  const listeners = new Set<() => void>()
  const subscribe = vi.fn((listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  })

  return {
    getRevision: () => revision,
    subscribe,
    notify: () => {
      revision += 1
      Array.from(listeners).forEach((listener) => listener())
    },
    listenerCount: () => listeners.size,
    reset: () => {
      revision = 0
      listeners.clear()
      subscribe.mockClear()
    },
  }
})

vi.mock('@/config', () => ({ API_PREFIX: '/console/api' }))
vi.mock('@/service/session-refresh-events', () => ({
  getSessionRefreshRevision: sessionRefresh.getRevision,
  subscribeToSessionRefresh: sessionRefresh.subscribe,
  notifySessionRefreshed: sessionRefresh.notify,
}))

const accountId = '11111111-1111-1111-1111-111111111111'
const fileId = '22222222-2222-2222-2222-222222222222'
const stableAvatar = `/console/api/accounts/${accountId}/avatars/${fileId}`
const nextStableAvatar = `/console/api/accounts/${accountId}/avatars/33333333-3333-3333-3333-333333333333`

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

const requireImage = (images: ControlledImage[], index: number) => {
  const image = images[index]
  if (!image) throw new Error(`Expected controlled image at index ${index}`)
  return image
}

const avatar = (src: string, props: Omit<AvatarImageProps, 'alt' | 'src'> = {}) => (
  <Avatar>
    <AvatarFallback>A</AvatarFallback>
    <AccountAvatarImage src={src} alt="" {...props} />
  </Avatar>
)

const renderAvatar = (src: string, props: Omit<AvatarImageProps, 'alt' | 'src'> = {}) => {
  const images: ControlledImage[] = []
  class MockImage extends ControlledImage {
    constructor() {
      super()
      images.push(this)
    }
  }
  vi.spyOn(window, 'Image').mockImplementation(MockImage as unknown as typeof window.Image)
  const result = render(avatar(src, props))
  return {
    ...result,
    images,
    rerenderAvatar: (nextSrc: string) => result.rerender(avatar(nextSrc, props)),
  }
}

describe('AccountAvatarImage', () => {
  beforeEach(() => {
    sessionRefresh.reset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('retries a failed stable avatar once after an observed session refresh', async () => {
    const { images } = renderAvatar(stableAvatar)
    expect(sessionRefresh.listenerCount()).toBe(0)

    act(() => requireImage(images, 0).fail())
    expect(sessionRefresh.listenerCount()).toBe(1)
    expect(images).toHaveLength(1)

    act(() => notifySessionRefreshed())

    await waitFor(() => expect(images).toHaveLength(2))
    expect(sessionRefresh.listenerCount()).toBe(0)
    expect(requireImage(images, 1).src).toBe(requireImage(images, 0).src)

    act(() => requireImage(images, 1).fail())
    act(() => notifySessionRefreshed())
    expect(sessionRefresh.listenerCount()).toBe(0)
    expect(images).toHaveLength(2)
  })

  it('retries when the session refresh completes while the initial image is pending', async () => {
    const { images } = renderAvatar(stableAvatar)
    act(() => notifySessionRefreshed())
    expect(sessionRefresh.listenerCount()).toBe(0)

    act(() => requireImage(images, 0).fail())

    await waitFor(() => expect(images).toHaveLength(2))
    expect(requireImage(images, 1).src).toBe(requireImage(images, 0).src)
    expect(sessionRefresh.listenerCount()).toBe(0)
  })

  it('does not count a refresh completed before the avatar mounted', async () => {
    act(() => notifySessionRefreshed())
    const { images } = renderAvatar(stableAvatar)

    act(() => requireImage(images, 0).fail())
    expect(images).toHaveLength(1)
    expect(sessionRefresh.listenerCount()).toBe(1)

    act(() => notifySessionRefreshed())
    await waitFor(() => expect(images).toHaveLength(2))
  })

  it.each([
    ['an external avatar', 'https://images.example.com/user.png'],
    ['a stable-path lookalike', `${stableAvatar}/extra`],
    ['a stable URL with query parameters', `${stableAvatar}?signature=legacy`],
  ])('does not subscribe or retry a failed %s', (_name, src) => {
    const { images } = renderAvatar(src)

    act(() => requireImage(images, 0).fail())
    act(() => notifySessionRefreshed())

    expect(sessionRefresh.listenerCount()).toBe(0)
    expect(sessionRefresh.subscribe).not.toHaveBeenCalled()
    expect(images).toHaveLength(1)
  })

  it('preserves loading-status and native image callbacks', () => {
    const onLoadingStatusChange = vi.fn()
    const { images } = renderAvatar(stableAvatar, { onLoadingStatusChange })

    expect(onLoadingStatusChange).toHaveBeenCalledWith('loading')
    act(() => requireImage(images, 0).fail())
    expect(onLoadingStatusChange).toHaveBeenCalledWith('error')

    const onError = vi.fn()
    const { container } = render(
      avatar('https://images.example.com/user.png', { keepMounted: true, onError }),
    )
    const image = container.querySelector('img')
    if (!image) throw new Error('Expected a mounted avatar image')
    fireEvent.error(image)
    expect(onError).toHaveBeenCalledOnce()
  })

  it('cleans a pending refresh subscription when the source changes or unmounts', () => {
    const { images, rerenderAvatar, unmount } = renderAvatar(stableAvatar)

    act(() => requireImage(images, 0).fail())
    expect(sessionRefresh.listenerCount()).toBe(1)

    rerenderAvatar(nextStableAvatar)
    expect(sessionRefresh.listenerCount()).toBe(0)

    act(() => requireImage(images, 1).fail())
    expect(sessionRefresh.listenerCount()).toBe(1)

    unmount()
    expect(sessionRefresh.listenerCount()).toBe(0)
  })
})
