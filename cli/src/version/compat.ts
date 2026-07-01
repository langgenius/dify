import { parseRange, satisfies, tryParse } from 'std-semver'

export type DifyCompat = {
  readonly minDify: string
  readonly maxDify: string
}

export const difyCompat: DifyCompat = {
  minDify: __DIFYCTL_MIN_DIFY__,
  maxDify: __DIFYCTL_MAX_DIFY__,
}

export function compatString(): string {
  return `dify >=${difyCompat.minDify}, <=${difyCompat.maxDify}`
}

export type CompatStatus = 'compatible' | 'unsupported' | 'unknown'

export type CompatVerdict = {
  readonly status: CompatStatus
  readonly detail: string
}

const DETAIL_MAX_LEN = 80

function clamp(s: string): string {
  return s.length > DETAIL_MAX_LEN ? `${s.slice(0, DETAIL_MAX_LEN)}…` : s
}

export function evaluateCompat(
  serverVersion: string | undefined,
  range: DifyCompat = difyCompat,
): CompatVerdict {
  if (serverVersion === undefined || serverVersion === '')
    return { status: 'unknown', detail: 'server version unknown' }

  const parsedServer = tryParse(serverVersion)
  if (parsedServer === undefined)
    return { status: 'unknown', detail: `server version ${JSON.stringify(clamp(serverVersion))} is not valid semver` }

  // The compat range is inclusive at both ends, exactly the format compatString prints.
  const expr = `>=${range.minDify} <=${range.maxDify}`
  const parsedRange = (() => {
    try {
      return parseRange(expr)
    }
    catch {
      return undefined
    }
  })()
  if (parsedRange === undefined)
    return { status: 'unknown', detail: `compat range ${JSON.stringify(expr)} is not valid semver` }

  if (satisfies(parsedServer, parsedRange))
    return { status: 'compatible', detail: `server ${serverVersion} in [${range.minDify}, ${range.maxDify}]` }

  return { status: 'unsupported', detail: `server ${serverVersion} outside [${range.minDify}, ${range.maxDify}]` }
}
