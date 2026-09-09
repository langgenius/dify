import type { ContactOption } from '@dify/contracts/api/console/workspaces/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'
import { consoleQuery } from '@/service/client'

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
  const contactOptions = consoleQuery.workspaces.current.humanInput.contactOptions
  const searchPage = async (keyword: string, page: number) => {
    if (!workspaceId) return { data: [], page, hasMore: false }
    const input = { query: { keyword: keyword.trim(), page, limit: 20 } }
    const response = await queryClient.fetchQuery(
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
      const response = await queryClient.fetchQuery(
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

const MOCK_CONTACT_OPTIONS: ContactRecipientOption[] = [
  {
    id: 'contact-evan',
    name: 'Evan Zhang',
    email: 'evan@example.com',
    source: 'workspace',
  },
  {
    id: 'contact-amanda',
    name: 'Amanda Lin',
    email: 'amanda@example.com',
    source: 'organization',
  },
  {
    id: 'contact-morgan',
    name: 'Morgan Lee',
    email: 'morgan@external.example',
    source: 'external',
  },
]

const waitForMockTick = () => Promise.resolve()

export const mockContactRecipientOptionProvider: ContactRecipientOptionProvider = {
  async search(query) {
    await waitForMockTick()
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return MOCK_CONTACT_OPTIONS.map((option) => ({ ...option }))
    return MOCK_CONTACT_OPTIONS.filter(
      (option) =>
        option.name.toLowerCase().includes(normalizedQuery) ||
        option.email.toLowerCase().includes(normalizedQuery),
    ).map((option) => ({ ...option }))
  },
  async resolve({ contact_ids }) {
    await waitForMockTick()
    const idSet = new Set(contact_ids)
    return MOCK_CONTACT_OPTIONS.filter((option) => idSet.has(option.id)).map((option) => ({
      ...option,
    }))
  },
}
