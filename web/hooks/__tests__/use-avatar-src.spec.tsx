import { act, renderHook, waitFor } from '@testing-library/react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { useAvatarSrc } from '../use-avatar-src'

const file = 'https://files.example.com/avatar.png'
const signedAvatarUrl = (issuedBefore: number, expiresAt: number) =>
  `/files/avatar-id/file-preview?nonce=opaque&issued_before=${issuedBefore}&expires_at=${expiresAt}&sign=${issuedBefore}`

const renderAvatars = (...urls: string[]) => {
  const { wrapper } = createConsoleQueryWrapper()
  return renderHook(() => urls.map((url) => useAvatarSrc(url)), { wrapper })
}

describe('useAvatarSrc', () => {
  it('shows every avatar of a file under the first URL received for it', () => {
    const { result } = renderAvatars(`${file}?sign=a`, `${file}?sign=b`)

    expect(result.current.map((avatar) => avatar.src)).toEqual([`${file}?sign=a`, `${file}?sign=a`])
  })

  it('keeps the shared URL until a replacement window reaches its expiry', () => {
    const timestamp = 1_800_000_000
    const shared = signedAvatarUrl(timestamp + 60, timestamp + 300)
    const early = signedAvatarUrl(timestamp + 240, timestamp + 480)
    const replacement = signedAvatarUrl(timestamp + 300, timestamp + 540)
    const { result } = renderAvatars(shared, early, replacement)

    expect(result.current.map((avatar) => avatar.src)).toEqual([shared, shared, replacement])
  })

  it.each([-1, 1])('prefers a newer overlapping signature with %i-hour clock skew', (clockSkew) => {
    const timestamp = 1_880_000_000
    const clock = vi.spyOn(Date, 'now').mockReturnValue((timestamp + 95 + clockSkew * 3600) * 1000)
    onTestFinished(() => clock.mockRestore())
    const shared = signedAvatarUrl(timestamp + 47, timestamp + 95)
    const fresh = signedAvatarUrl(timestamp + 141, timestamp + 189)
    const { result } = renderAvatars(shared, fresh)

    expect(result.current.map((avatar) => avatar.src)).toEqual([shared, fresh])

    act(() => result.current[1]!.onLoadingStatusChange('error'))
    expect(result.current[1]!.src).toBe(shared)
  })

  it('moves every avatar of a file to a URL that loads when the shared one fails', async () => {
    const { result } = renderAvatars(`${file}?sign=a`, `${file}?sign=b`)

    act(() => result.current[1]!.onLoadingStatusChange('error'))
    expect(result.current[1]!.src).toBe(`${file}?sign=b`)
    act(() => result.current[1]!.onLoadingStatusChange('loaded'))

    await waitFor(() =>
      expect(result.current.map((avatar) => avatar.src)).toEqual([
        `${file}?sign=b`,
        `${file}?sign=b`,
      ]),
    )
  })

  it('settles on the fallback when every URL it has fails, without trying them again', () => {
    const { result } = renderAvatars(`${file}?sign=a`, `${file}?sign=b`)

    act(() => result.current[1]!.onLoadingStatusChange('error'))
    act(() => result.current[1]!.onLoadingStatusChange('error'))

    expect(result.current[1]!.src).toBeUndefined()
    expect(result.current[0]!.src).toBe(`${file}?sign=a`)
  })

  it('leaves an avatar without a picture to its fallback', () => {
    const { result } = renderHook(() => useAvatarSrc(null), {
      wrapper: createConsoleQueryWrapper().wrapper,
    })

    expect(result.current.src).toBeUndefined()
  })
})
