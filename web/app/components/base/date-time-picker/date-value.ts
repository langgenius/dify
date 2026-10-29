import { isValid, parseISO } from 'date-fns'

export function parseDateValue(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000'))
    return undefined
  // UTC keeps civil-date validation independent of local daylight-saving transitions.
  return isValid(parseISO(`${value}T00:00:00Z`)) ? value : undefined
}
