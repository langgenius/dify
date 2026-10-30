import dayjs from 'dayjs'
import { NUM_INFINITE } from '@/app/components/billing/config'

// App, member, document upload, and annotation quotas use 0 for unlimited.
// Event and API quotas use -1 for unlimited and must preserve 0 as zero capacity.
export const parseLimit = (limit: number) => {
  if (limit === 0) return NUM_INFINITE

  return limit
}

const normalizeResetDate = (resetDate: number) => {
  if (resetDate <= 0) return null

  if (resetDate >= 1e12) return dayjs(resetDate)

  if (resetDate >= 1e9) return dayjs(resetDate * 1000)

  const digits = resetDate.toString()
  if (digits.length === 8) {
    const year = digits.slice(0, 4)
    const month = digits.slice(4, 6)
    const day = digits.slice(6, 8)
    const parsed = dayjs(`${year}-${month}-${day}`)
    return parsed.isValid() ? parsed : null
  }

  return null
}

export const getResetInDaysFromDate = (resetDate: number) => {
  const resetDay = normalizeResetDate(resetDate)
  if (!resetDay) return null

  const diff = resetDay.startOf('day').diff(dayjs().startOf('day'), 'day')
  if (Number.isNaN(diff) || diff < 0) return null

  return diff
}
