import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { createHttpError } from '../http-error'
import { useRequestErrorDescriber, useRequestErrorMessage } from '../use-request-error-message'

const httpError = (status: number, body?: unknown) =>
  createHttpError({ status, statusText: '', headers: new Headers() }, body)

describe('useRequestErrorMessage', () => {
  it('has no message without an error', () => {
    const { result } = renderHook(() => useRequestErrorMessage(null, 'Could not load'))

    expect(result.current).toBeUndefined()
  })

  it('resolves the message for an error', () => {
    const error = httpError(404, { code: 'not_found', message: 'Workflow not found' })
    const { result } = renderHook(() => useRequestErrorMessage(error))

    expect(result.current).toBe('Workflow not found')
  })
})

describe('useRequestErrorDescriber', () => {
  it('describes each error with its own fallback', () => {
    const { result } = renderHook(() => useRequestErrorDescriber())
    const notFound = httpError(404, { code: 'not_found', message: 'Workflow not found' })

    expect(result.current(notFound, 'Could not open the workflow')).toBe(
      'Could not open the workflow',
    )
    expect(result.current(notFound)).toBe('Workflow not found')
    expect(result.current(httpError(403, { code: 'paid_plan_required', message: 'x' }))).toBe(
      'requestErrors.code.paid_plan_required',
    )
  })
})
