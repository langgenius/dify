import type { ClaimablePassportResponse } from '@dify/contracts/api/web/types.gen'
import { basePath } from '@/utils/var'
import {
  captureWebAppAuthSession,
  getAnonymousWebAppPassports,
  removeAnonymousWebAppPassport,
} from '../webapp-auth'
import { webAppClient } from './index'
import { resolveWebAppAccountReturn } from './login'

type AnonymousPassport = ReturnType<typeof getAnonymousWebAppPassports>[number]
export type MigrationCandidate = ClaimablePassportResponse & {
  credential: AnonymousPassport
}

const BATCH_SIZE = 50

export function getWebAppMigrationTarget(returnUrl: string) {
  const target = resolveWebAppAccountReturn(returnUrl)
  if (!target || getAnonymousWebAppPassports().length === 0) return returnUrl
  const url = new URL(
    `${basePath}/chat/${encodeURIComponent(target.address.code)}/migrate-conversations`,
    window.location.origin,
  )
  url.searchParams.set('redirect_url', target.url)
  return url.href
}

export async function loadWebAppMigrationCandidates(signal?: AbortSignal) {
  const credentials = getAnonymousWebAppPassports()
  const candidates: MigrationCandidate[] = []
  for (let offset = 0; offset < credentials.length; offset += BATCH_SIZE) {
    const batch = credentials.slice(offset, offset + BATCH_SIZE)
    const response = await webAppClient.migration.claimablePassports.post(
      { body: { passports: batch.map(({ passport }) => passport) } },
      { signal, context: { silent: true } },
    )
    for (const item of response.data) {
      const credential = batch[item.index]
      if (credential && (item.connection_count > 0 || item.conversation_count > 0))
        candidates.push({ ...item, credential })
    }
  }
  return candidates
}

export async function claimWebAppMigration(candidates: MigrationCandidate[]) {
  const isCurrentSession = captureWebAppAuthSession()
  const assertCurrentSession = () => {
    if (!isCurrentSession()) throw new DOMException('The Web App account changed.', 'AbortError')
  }
  // Successful items are removed immediately, so retries only submit remaining snapshots.
  const retained = getAnonymousWebAppPassports()
  const pending = candidates.filter(({ credential }) =>
    retained.some(
      ({ key, passport }) => key === credential.key && passport === credential.passport,
    ),
  )
  const failures: string[] = []
  for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
    assertCurrentSession()
    const batch = pending.slice(offset, offset + BATCH_SIZE)
    const response = await webAppClient.migration.claim.post(
      { body: { passports: batch.map(({ credential }) => credential.passport) } },
      { context: { silent: true } },
    )
    assertCurrentSession()
    for (const result of response.data) {
      const candidate = batch[result.index]
      if (!candidate) continue
      if (result.status === 'failed') {
        failures.push(result.error.message)
        continue
      }
      removeAnonymousWebAppPassport(candidate.credential)
    }
  }
  if (failures.length) throw new Error([...new Set(failures)].join('\n'))
}
