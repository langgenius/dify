export type DevProxyProtocolEnv = Partial<Record<
  | 'NEXT_PUBLIC_API_PREFIX'
  | 'NEXT_PUBLIC_PUBLIC_API_PREFIX',
  string
>>

const isHttpsUrl = (value?: string) => {
  if (!value)
    return false

  try {
    return new URL(value).protocol === 'https:'
  }
  catch {
    return false
  }
}

export const shouldUseHttpsForDevProxy = (env: DevProxyProtocolEnv = {}) => {
  return isHttpsUrl(env.NEXT_PUBLIC_API_PREFIX) || isHttpsUrl(env.NEXT_PUBLIC_PUBLIC_API_PREFIX)
}
