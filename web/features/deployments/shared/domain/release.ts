import type { Release } from '@dify/contracts/enterprise/types.gen'
import { formatTime } from '@/utils/time'

export function formatDate(value?: string) {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    return value
      .replace('T', ' ')
      .replace(/\.\d+Z?$/, '')
      .replace(/Z$/, '')
      .slice(0, 16)

  return formatTime({ date, dateFormat: 'YYYY-MM-DD HH:mm' })
}

export function releaseCommit(release?: Release) {
  return release?.gateCommitId ? release.gateCommitId.slice(0, 8) : '—'
}
