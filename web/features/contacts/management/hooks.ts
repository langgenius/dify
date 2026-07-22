'use client'

import type {
  AvailablePlatformContactsQuery,
  ContactsListQuery,
  ContactView,
  CreateExternalContactCommand,
  RemoveContactsCommand,
  RemoveMemberCommand,
} from './types'
import {
  infiniteQueryOptions,
  mutationOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useContactsFeatureContext, useContactsManagementRepository } from './composition-context'
import { contactsManagementQueryKeys } from './query-keys'

function mergeContactPages(pages: ContactView[][]): ContactView[] {
  const contacts = new Map<string, ContactView>()
  for (const page of pages) {
    for (const contact of page) contacts.set(contact.id, contact)
  }
  return [...contacts.values()]
}

export function useContactsDirectory(query: Omit<ContactsListQuery, 'deployment' | 'page'>) {
  const context = useContactsFeatureContext()
  const repository = useContactsManagementRepository()
  const result = useInfiniteQuery(
    infiniteQueryOptions({
      initialPageParam: 1,
      queryFn: ({ pageParam }) =>
        repository.listContacts({ ...query, deployment: context.deployment, page: pageParam }),
      queryKey: [...contactsManagementQueryKeys.directory(context, query), repository] as const,
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
    }),
  )

  return {
    contacts: mergeContactPages(result.data?.pages.map((page) => page.data) ?? []),
    data: result.data,
    error: result.error,
    fetchNextPage: result.fetchNextPage,
    hasNextPage: result.hasNextPage,
    isError: result.isError,
    isFetchNextPageError: result.isFetchNextPageError,
    isFetchingNextPage: result.isFetchingNextPage,
    isPending: result.isPending,
    refetch: result.refetch,
  }
}

export function useAvailablePlatformContacts(
  query: Omit<AvailablePlatformContactsQuery, 'page'>,
  enabled: boolean,
) {
  const context = useContactsFeatureContext()
  const repository = useContactsManagementRepository()
  const result = useInfiniteQuery(
    infiniteQueryOptions({
      enabled: enabled && context.deployment === 'ee',
      initialPageParam: 1,
      queryFn: ({ pageParam }) =>
        repository.listAvailablePlatformContacts({ ...query, page: pageParam }),
      queryKey: [
        ...contactsManagementQueryKeys.availablePlatformContacts(context.workspaceId, query),
        repository,
      ] as const,
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
    }),
  )

  return {
    contacts: result.data?.pages.flatMap((page) => page.data) ?? [],
    error: result.error,
    fetchNextPage: result.fetchNextPage,
    hasNextPage: result.hasNextPage,
    isError: result.isError,
    isFetchingNextPage: result.isFetchingNextPage,
    isPending: result.isPending,
    refetch: result.refetch,
  }
}

export function useCreateExternalContact() {
  const context = useContactsFeatureContext()
  const repository = useContactsManagementRepository()
  const queryClient = useQueryClient()

  return useMutation(
    mutationOptions({
      mutationFn: (command: CreateExternalContactCommand) =>
        repository.createExternalContact(command),
      onSuccess: (result) => {
        if (result.kind !== 'created') return
        void queryClient.invalidateQueries({
          queryKey: contactsManagementQueryKeys.all(context.workspaceId),
        })
      },
    }),
  )
}

export function useAddPlatformContacts() {
  const context = useContactsFeatureContext()
  const repository = useContactsManagementRepository()
  const queryClient = useQueryClient()

  return useMutation(
    mutationOptions({
      mutationFn: (contactIds: string[]) => repository.addPlatformContacts({ contactIds }),
      onSuccess: (result) => {
        if (result.kind !== 'added') return
        void queryClient.invalidateQueries({
          queryKey: contactsManagementQueryKeys.all(context.workspaceId),
        })
      },
    }),
  )
}

export function useRemoveContacts() {
  const context = useContactsFeatureContext()
  const repository = useContactsManagementRepository()
  const queryClient = useQueryClient()

  return useMutation(
    mutationOptions({
      mutationFn: (command: RemoveContactsCommand) => repository.removeContacts(command),
      onSuccess: (result) => {
        if (result.kind !== 'removed') return
        void queryClient.invalidateQueries({
          queryKey: contactsManagementQueryKeys.all(context.workspaceId),
        })
      },
    }),
  )
}

export function useMemberRemovalImpact(memberId: string, enabled: boolean) {
  const context = useContactsFeatureContext()
  const repository = useContactsManagementRepository()
  return useQuery(
    queryOptions({
      enabled,
      queryFn: () => repository.getMemberRemovalImpact(memberId),
      queryKey: [
        ...contactsManagementQueryKeys.all(context.workspaceId),
        'member-removal-impact',
        memberId,
        repository,
      ] as const,
    }),
  )
}

export function useRemoveContactMember() {
  const context = useContactsFeatureContext()
  const repository = useContactsManagementRepository()
  const queryClient = useQueryClient()
  return useMutation(
    mutationOptions({
      mutationFn: (command: RemoveMemberCommand) => repository.removeMember(command),
      onSuccess: (result) => {
        if (result.kind !== 'removed') return
        void queryClient.invalidateQueries({
          queryKey: contactsManagementQueryKeys.all(context.workspaceId),
        })
      },
    }),
  )
}
