import type { ContactOption } from '@dify/contracts/api/console/workspaces/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'
import { consoleQuery } from '@/service/console'

export type ContactRecipientOption = {
  id: string
  name: string
  email: string
  avatar?: string
  source: 'workspace' | 'organization' | 'external'
}

export type ContactRecipientOptionProvider = {
  search: (query: string) => Promise<ContactRecipientOption[]>
  searchPage?: (
    query: string,
    page: number,
  ) => Promise<{
    data: ContactRecipientOption[]
    page: number
    hasMore: boolean
  }>
  resolve: (query: { contact_ids: string[] }) => Promise<ContactRecipientOption[]>
}

const toRecipientOption = (contact: ContactOption): ContactRecipientOption => ({
  id: contact.id,
  name: contact.name,
  email: contact.email ?? '',
  avatar: contact.avatar_url ?? undefined,
  source: contact.type === 'platform' ? 'organization' : contact.type,
})

export function createContactRecipientOptionProvider(
  workspaceId: string,
  queryClient: QueryClient,
): ContactRecipientOptionProvider {
  const contactOptions = consoleQuery.workspaces.current.humanInput.v2.contactOptions
  const searchPage = async (keyword: string, page: number) => {
    if (!workspaceId) return { data: [], page, hasMore: false }
    const input = { query: { keyword: keyword.trim(), page, limit: 20 } }
    const response = await queryClient.query(
      contactOptions.get.queryOptions({
        input,
        queryKey: [...contactOptions.get.queryKey({ input }), { workspaceId }],
        staleTime: 0,
      }),
    )
    return {
      data: response.data.map(toRecipientOption),
      page: response.page,
      hasMore: response.page * response.limit < response.total,
    }
  }

  return {
    searchPage,
    async search(keyword) {
      return (await searchPage(keyword, 1)).data
    },
    async resolve({ contact_ids }) {
      if (!workspaceId || !contact_ids.length) return []
      const input = { query: { contact_ids: [...new Set(contact_ids)].sort() } }
      const response = await queryClient.query(
        contactOptions.batch.get.queryOptions({
          input,
          queryKey: [...contactOptions.batch.get.queryKey({ input }), { workspaceId }],
          staleTime: 0,
        }),
      )
      return response.data.map(toRecipientOption)
    },
  }
}

export function useContactRecipientOptionProvider() {
  const workspaceId = useAtomValue(currentWorkspaceIdAtom)
  const queryClient = useQueryClient()
  const provider = useMemo(
    () => createContactRecipientOptionProvider(workspaceId, queryClient),
    [workspaceId, queryClient],
  )
  return { provider, workspaceId }
}
