import { ORPCError } from '@orpc/client'
import { markAppDeletionFailed, markAppDeletionStarted } from '@/service/app-deletion'
import { createHttpError } from '@/service/http-error'
import { toastRequestError, toastStreamError, withRequestErrorToast } from '../request-error'

vi.mock('..', () => ({
  toast: {
    error: vi.fn(),
  },
}))

const { toast } = await import('..')

const requestError = (
  message: string,
  { status = 400, url }: { status?: number; url?: string } = {},
) =>
  new ORPCError('request_failed', {
    status,
    message,
    data: { message },
    cause: { headers: new Headers(), url },
  })

describe('toastRequestError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show the server message with a shared id for identical failures', () => {
    toastRequestError(requestError('Quota exceeded'))

    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Quota exceeded', {
      id: 'request-error:Quota exceeded',
    })
  })

  it('should title the toast with the caller message and explain it with the server message', () => {
    toastRequestError(requestError('Quota exceeded'), 'Failed to save')

    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Failed to save', {
      id: 'request-error:Failed to save:Quota exceeded',
      description: 'Quota exceeded',
    })
  })

  it('should show the caller message alone for failures without a server message', () => {
    toastRequestError(new TypeError('Failed to fetch'), 'Failed to save')

    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Failed to save', {
      id: 'request-error:Failed to save',
    })
  })

  it('should not present the status text of an empty response as the explanation', () => {
    const emptyBody = createHttpError(new Response(null, { status: 500 }))

    toastRequestError(emptyBody)
    expect(toast.error).not.toHaveBeenCalled()

    toastRequestError(emptyBody, 'Failed to save')
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Failed to save', {
      id: 'request-error:Failed to save',
    })
  })

  it.each([
    { title: 'unauthorized responses', error: requestError('Unauthorized', { status: 401 }) },
    {
      title: 'aborted requests',
      error: new DOMException('The operation was aborted.', 'AbortError'),
    },
    { title: 'errors without a request message', error: new TypeError('Failed to fetch') },
  ])('should stay quiet for $title', ({ error }) => {
    toastRequestError(error)

    expect(toast.error).not.toHaveBeenCalled()
  })

  it('should explain a rejected sign-in, which the transport does not redirect', () => {
    toastRequestError(
      requestError('Invalid email or password', {
        status: 401,
        url: 'http://localhost/api/login',
      }),
    )

    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Invalid email or password', {
      id: 'request-error:Invalid email or password',
    })
  })

  it('should stay quiet for workflow requests that race an app deletion', () => {
    const appId = 'deleting-app'
    markAppDeletionStarted(appId)
    try {
      toastRequestError(
        requestError('App not found', {
          status: 404,
          url: `http://localhost/console/api/apps/${appId}/workflows/draft`,
        }),
      )
    } finally {
      markAppDeletionFailed(appId)
    }

    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('withRequestErrorToast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should toast the failure and keep the request rejected', async () => {
    const error = requestError('Quota exceeded')

    await expect(withRequestErrorToast(Promise.reject(error))).rejects.toBe(error)
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Quota exceeded', {
      id: 'request-error:Quota exceeded',
    })
  })

  it('should resolve successful requests unchanged', async () => {
    await expect(withRequestErrorToast(Promise.resolve('ok'))).resolves.toBe('ok')
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('toastStreamError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show stream failures on the global host by default', () => {
    toastStreamError('Model rate limited')

    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Model rate limited', {
      id: 'request-error:Model rate limited',
    })
  })

  it('should show stream failures on a page-specific host', () => {
    const notify = vi.fn()

    toastStreamError('Model rate limited', notify)

    expect(notify).toHaveBeenCalledExactlyOnceWith('Model rate limited')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each(['AbortError', 'AbortError: The user aborted a request.', ''])(
    'should stay quiet for cancelled streams: %s',
    (message) => {
      toastStreamError(message)

      expect(toast.error).not.toHaveBeenCalled()
    },
  )
})
