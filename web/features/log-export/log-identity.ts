import type { ConversationLogIdentityResponse } from '@dify/contracts/api/console/apps/types.gen'

export type LogIdentity = ConversationLogIdentityResponse

export const identityKey = ({ id, source }: LogIdentity) => `${source}:${id}`

export function logIdentityFilters(identities: LogIdentity[] = []) {
  const end_user_ids = identities.filter(({ source }) => source === 'end-user').map(({ id }) => id)
  const account_ids = identities.filter(({ source }) => source === 'account').map(({ id }) => id)
  return {
    ...(end_user_ids.length ? { end_user_ids } : {}),
    ...(account_ids.length ? { account_ids } : {}),
  }
}

export function logIdentityLabels(
  filters: { end_user_ids: string[]; account_ids?: string[] },
  options: LogIdentity[],
) {
  const label = (id: string, source: LogIdentity['source']) =>
    options.find((identity) => identity.id === id && identity.source === source)?.label || id
  return [
    ...filters.end_user_ids.map((id) => label(id, 'end-user')),
    ...(filters.account_ids ?? []).map((id) => label(id, 'account')),
  ]
}
