import type { Release } from '@dify/contracts/enterprise/types.gen'

export function formatDate(value?: string) {
  if (!value)
    return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    return value.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '').slice(0, 16)

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function releaseLabel(release?: Release) {
  return release?.name || release?.id || '—'
}

export function releaseCommit(release?: Release) {
  return release?.gateCommitId ? release.gateCommitId.slice(0, 8) : '—'
}
