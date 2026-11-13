import { skipToken } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

// The node card, editor and publish check must observe the same authoritative lookup.
export function getContactRecipientQueryOptions(
  workspaceId: string,
  contactIds: readonly string[],
) {
  const operation = consoleQuery.workspaces.current.humanInput.v2.contactOptions.batch.get
  const input =
    workspaceId && contactIds.length
      ? { query: { contact_ids: [...new Set(contactIds)].sort() } }
      : skipToken

  return operation.queryOptions({
    input,
    queryKey: [...operation.queryKey({ input }), { workspaceId }],
    staleTime: 0,
    retry: false,
    context: { silent: true },
  })
}
