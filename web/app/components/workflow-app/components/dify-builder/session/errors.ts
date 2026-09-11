import type { DifyBuilderStreamEventResponse } from '@dify/contracts/api/console/dify-builder/types.gen'
import { zBuilderErrorCode } from '@dify/contracts/api/console/dify-builder/zod.gen'

export const UNEXPECTED_EOF_ERROR = 'Builder stream ended before a terminal event.'

export const requestErrorStatus = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null) return undefined
  if ('status' in error && typeof error.status === 'number') return error.status
  if ('data' in error) {
    const data = error.data
    if (typeof data === 'object' && data !== null && 'status' in data)
      return typeof data.status === 'number' ? data.status : undefined
  }
}

export const requestErrorCode = async (error: unknown) => {
  let body: unknown = error
  if (error instanceof Response) {
    try {
      body = await error.clone().json()
    } catch {
      return null
    }
  } else if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = error.data
    body = typeof data === 'object' && data !== null && 'body' in data ? data.body : data
  }
  if (typeof body !== 'object' || body === null || !('code' in body)) return null
  const code = zBuilderErrorCode.safeParse(body.code)
  return code.success ? code.data : null
}

export const requestErrorMessage = async (error: unknown): Promise<string> => {
  const status = requestErrorStatus(error)
  let body: unknown = error
  if (error instanceof Response) {
    try {
      body = await error.clone().json()
    } catch {
      return `HTTP ${error.status}${error.statusText ? `: ${error.statusText}` : ''}`
    }
  }
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = error.data
    body = typeof data === 'object' && data !== null && 'body' in data ? data.body : data
  }
  if (typeof body === 'object' && body !== null) {
    const details = [
      'code' in body ? body.code : undefined,
      'message' in body ? body.message : undefined,
      'error' in body ? body.error : undefined,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0)
    const message = [...new Set(details)].join(': ')
    if (message) return status ? `HTTP ${status}: ${message}` : message
  }
  if (status) return `HTTP ${status}`
  return error instanceof Error ? error.message : String(error)
}

export const streamErrorMessage = (
  data: Extract<DifyBuilderStreamEventResponse, { event: 'error' }>['data'],
) => {
  if (typeof data.error === 'string') return data.error
  if (typeof data.message === 'string') return data.message
  if (typeof data.code === 'string') return data.code
  return 'Builder command failed.'
}
