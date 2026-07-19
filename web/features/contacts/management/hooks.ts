'use client'

import type {
  ContactsListQuery,
  CreateExternalContactCommand,
  OrganizationCandidateQuery,
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
import { mergeContactPages } from './mock/repository'
import { contactsManagementQueryKeys } from './query-keys'

export function useContactsDirectory(query: Omit<ContactsListQuery, 'cursor' | 'deployment'>) {
  const context = useContactsFeatureContext()
  const repository = useContactsManagementRepository()
  const result = useInfiniteQuery(
    infiniteQueryOptions({
      initialPageParam: null as string | null,
      queryFn: ({ pageParam }: { pageParam: string | null }) =>
        repository.listContacts({ ...query, cursor: pageParam, deployment: context.deployment }),
      queryKey: [...contactsManagementQueryKeys.directory(context, query), repository] as const,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }),
  )

  return {
    contacts: mergeContactPages(result.data?.pages.map((page) => page.items) ?? []),
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

export function useContactDetails(contactId: string | null) {
  const context = useContactsFeatureContext()
  const repository = useContactsManagementRepository()
  return useQuery(
    queryOptions({
      enabled: Boolean(contactId),
      queryFn: () => repository.getContact(contactId as string),
      queryKey: [
        ...contactsManagementQueryKeys.detail(context.workspaceId, contactId ?? 'none'),
        repository,
      ] as const,
    }),
  )
}

export function useOrganizationCandidates(
  query: Omit<OrganizationCandidateQuery, 'cursor'>,
  enabled: boolean,
) {
  const context = useContactsFeatureContext()
  const repository = useContactsManagementRepository()
  const result = useInfiniteQuery(
    infiniteQueryOptions({
      enabled: enabled && context.deployment === 'ee',
      initialPageParam: null as string | null,
      queryFn: ({ pageParam }: { pageParam: string | null }) =>
        repository.searchOrganizationCandidates({ ...query, cursor: pageParam }),
      queryKey: [
        ...contactsManagementQueryKeys.organizationCandidates(context.workspaceId, query),
        repository,
      ] as const,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }),
  )

  return {
    candidates: result.data?.pages.flatMap((page) => page.items) ?? [],
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
      mutationFn: (candidateIds: string[]) => repository.addPlatformContacts({ candidateIds }),
      onSuccess: (result) => {
        if (result.kind !== 'added') return
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
