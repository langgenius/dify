import { act, renderHook } from '@testing-library/react'
import { useDifyBuilderSession } from '../use-dify-builder-session'

describe('useDifyBuilderSession', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.cookie = 'csrf_token=; Max-Age=0; path=/'
  })

  it('should use only CORS-approved headers when creating a session', async () => {
    document.cookie = 'csrf_token=test-csrf-token; path=/'
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 201 }))
    const { result } = renderHook(() =>
      useDifyBuilderSession({
        baseUrl: 'http://localhost:5001/console/api',
      }),
    )

    await act(async () => {
      await result.current.startFix('app-1', 'run-1')
    })

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]!
    const headers = new Headers(init?.headers)
    expect(url).toBe('http://localhost:5001/console/api/dify-builder/sessions')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('X-CSRF-Token')).toBe('test-csrf-token')
    expect(headers.has('X-Workspace-Id')).toBe(false)
  })
})
