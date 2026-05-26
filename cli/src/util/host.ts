import { BaseError } from '../errors/base.js'
import { ErrorCode } from '../errors/codes.js'

export const DEFAULT_HOST = 'https://cloud.dify.ai'

export type ResolveHostOptions = {
  raw: string
  insecure: boolean
}

export function resolveHost(opts: ResolveHostOptions): string {
  let raw = opts.raw.trim()
  if (raw === '')
    raw = DEFAULT_HOST
  if (!raw.includes('://'))
    raw = `https://${raw}`
  let url: URL
  try {
    url = new URL(raw)
  }
  catch (err) {
    throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message: `host parse: ${(err as Error).message}` })
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  if (url.protocol !== 'https:' && !(opts.insecure && url.protocol === 'http:')) {
    throw new BaseError({
      code: ErrorCode.UsageInvalidFlag,
      message: 'only https:// hosts are accepted',
      hint: 'add --insecure to allow http:// (local-dev only; user_code/device_code travel plaintext)',
    })
  }
  const out = url.toString()
  return out.endsWith('/') ? out.slice(0, -1) : out
}

export function hostWithScheme(host: string, scheme: string | undefined): string {
  if (host.includes('://'))
    return host
  const proto = scheme === undefined || scheme === '' ? 'https' : scheme
  return `${proto}://${host}`
}

export function bareHost(raw: string): string {
  try {
    const u = new URL(raw)
    return u.host !== '' ? u.host : raw
  }
  catch {
    return raw
  }
}

export function validateVerificationURI(raw: string, insecure: boolean): void {
  let url: URL
  try {
    url = new URL(raw.trim())
  }
  catch {
    throw new BaseError({ code: ErrorCode.Unknown, message: `server returned invalid verification_uri "${raw}"` })
  }
  if (url.protocol !== 'https:' && !(insecure && url.protocol === 'http:')) {
    throw new BaseError({
      code: ErrorCode.Unknown,
      message: `server returned verification_uri with unsupported scheme "${url.protocol.replace(':', '')}"`,
      hint: 'expected https:// (use --insecure to allow http:// on local-dev hosts)',
    })
  }
  if (url.host === '')
    throw new BaseError({ code: ErrorCode.Unknown, message: `server returned verification_uri without host: "${raw}"` })
}
