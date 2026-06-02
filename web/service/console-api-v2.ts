import { API_PREFIX, API_V2_PREFIX } from '@/config'

const LEGACY_CONSOLE_API_SUFFIX = '/console/api'
const API_ROOT_SUFFIX = '/api'
const API_V2_SUFFIX = '/api/v2'

export const consoleApiV2PrefixFrom = (configuredApiPrefix: string) => {
  const apiPrefix = configuredApiPrefix.replace(/\/+$/, '')
  if (apiPrefix.endsWith(API_V2_SUFFIX))
    return apiPrefix

  if (apiPrefix.endsWith(LEGACY_CONSOLE_API_SUFFIX))
    return `${apiPrefix.slice(0, -LEGACY_CONSOLE_API_SUFFIX.length)}/api/v2`

  if (apiPrefix.endsWith(API_ROOT_SUFFIX))
    return `${apiPrefix}/v2`

  return `${apiPrefix}/api/v2`
}

export const consoleApiV2Prefix = () => {
  if (API_V2_PREFIX)
    return API_V2_PREFIX

  return consoleApiV2PrefixFrom(API_PREFIX)
}
