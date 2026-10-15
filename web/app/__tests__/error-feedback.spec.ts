import { CancelledError } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { notifyError } from '../notifications/error'

const { errorToast } = vi.hoisted(() => ({ errorToast: vi.fn() }))
vi.mock('@/app/notifications', () => ({ toast: { error: errorToast } }))
vi.mock('react-i18next', () => ({ getI18n: () => ({ t: () => 'Action failed' }) }))

beforeEach(() => vi.clearAllMocks())

describe('business error feedback', () => {
  it('ignores query cancellation and both fetch and stream abort errors', () => {
    notifyError(new CancelledError())
    notifyError(new DOMException('The operation was aborted.', 'AbortError'))
    notifyError(new Error('AbortError: The operation was aborted.'))
    expect(errorToast).not.toHaveBeenCalled()
  })

  it('preserves server messages and provides a localized fallback for unknown rejections', () => {
    notifyError(new Error('The workflow draft has changed'))
    notifyError({ code: 'unknown' })
    expect(errorToast.mock.calls).toEqual([['The workflow draft has changed'], ['Action failed']])
  })
})
