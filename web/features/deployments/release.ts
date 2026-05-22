import type { Release } from '@dify/contracts/enterprise/types.gen'

export function formatDate(value?: string) {
  if (!value)
    return '—'
  return value.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '').slice(0, 16)
}

export function releaseLabel(release?: Release) {
  return release?.name || release?.id || '—'
}

export function releaseCommit(release?: Release) {
  return release?.gateCommitId ? release.gateCommitId.slice(0, 8) : '—'
}
