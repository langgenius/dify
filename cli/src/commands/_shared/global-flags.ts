import { newError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'

export const HTTP_RETRY_DEFAULT = 3

export type ResolveRetryAttemptsOpts = {
  flag: number | undefined
  env: (k: string) => string | undefined
}

export function resolveRetryAttempts(opts: ResolveRetryAttemptsOpts): number {
  if (opts.flag !== undefined)
    return opts.flag
  const raw = opts.env('DIFYCTL_HTTP_RETRY')
  if (raw === undefined || raw === '')
    return HTTP_RETRY_DEFAULT
  if (!/^-?\d+$/.test(raw))
    throw newError(ErrorCode.UsageInvalidFlag, `DIFYCTL_HTTP_RETRY: ${JSON.stringify(raw)} is not a non-negative integer`)
  const n = Number(raw)
  if (n < 0)
    throw newError(ErrorCode.UsageInvalidFlag, `DIFYCTL_HTTP_RETRY: ${n} is negative`)
  return n
}
