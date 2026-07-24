import { DisplayStatusList } from '@/models/datasets'

const KNOWN_STATUS_VALUES = new Set<string>([
  'all',
  ...DisplayStatusList.map(item => item.toLowerCase()),
])

const URL_STATUS_ALIASES: Record<string, string> = {
  active: 'available',
}

const QUERY_STATUS_ALIASES: Record<string, string> = {
  enabled: 'available',
}

export const sanitizeStatusValue = (value?: string | null) => {
  if (!value)
    return 'all'

  const normalized = value.toLowerCase()
  if (URL_STATUS_ALIASES[normalized])
    return URL_STATUS_ALIASES[normalized]

  return KNOWN_STATUS_VALUES.has(normalized) ? normalized : 'all'
}

export const normalizeStatusForQuery = (value?: string | null) => {
  const sanitized = sanitizeStatusValue(value)
  if (sanitized === 'all')
    return 'all'

  return QUERY_STATUS_ALIASES[sanitized] || sanitized
}
