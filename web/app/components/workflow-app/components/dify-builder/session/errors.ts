import type {
  DifyBuilderErrorResponse,
  DifyBuilderStreamEventResponse,
} from '@dify/contracts/api/console/dify-builder/types.gen'

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

export const requestErrorMessage = (error: unknown): string => {
  const status = requestErrorStatus(error)
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = error.data
    const body = typeof data === 'object' && data !== null && 'body' in data ? data.body : data
    const response = body as Partial<DifyBuilderErrorResponse> | undefined
    if (typeof response?.code === 'string')
      return status ? `HTTP ${status}: ${response.code}` : response.code
  }
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
