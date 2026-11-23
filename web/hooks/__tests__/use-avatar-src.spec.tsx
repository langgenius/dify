import { act, renderHook, waitFor } from '@testing-library/react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { useAvatarSrc } from '../use-avatar-src'

const file = 'https://files.example.com/avatar.png'

const renderAvatars = (...urls: string[]) => {
  const { wrapper } = createConsoleQueryWrapper()
  return renderHook(() => urls.map((url) => useAvatarSrc(url)), { wrapper })
}

describe('useAvatarSrc', () => {
  it('shows every avatar of a file under the first URL received for it', () => {
    const { result } = renderAvatars(`${file}?sign=a`, `${file}?sign=b`)

    expect(result.current.map((avatar) => avatar.src)).toEqual([`${file}?sign=a`, `${file}?sign=a`])
  })

  it('prefers a still-valid account avatar URL once the shared URL expires', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100_000)
    onTestFinished(() => clock.mockRestore())
    const accountAvatar = '/files/avatar-id/file-preview?nonce=account-avatar-v2%3Aaccount-id'
    const shared = `${accountAvatar}&expires_at=120&sign=a`
    const fresh = `${accountAvatar}&expires_at=180&sign=b`
    const { result, rerender } = renderAvatars(shared, fresh)

    expect(result.current.map((avatar) => avatar.src)).toEqual([shared, shared])

    clock.mockReturnValue(120_000)
    rerender()
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
