'use client'

import type {
  AddPlatformContactsCommand,
  AvailablePlatformContactsQuery,
  ContactsListQuery,
  ContactView,
  CreateExternalContactCommand,
  FindExternalContactsByEmailsCommand,
  RemoveContactsCommand,
  RemoveMemberCommand,
  UpdateExternalContactCommand,
  UpgradeExternalContactsToWorkspaceCommand,
} from './types'
import {
  infiniteQueryOptions,
  mutationOptions,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import {
  useContactsFeatureContext,
  useContactsManagementRepository,
  useOptionalContactsManagement,
} from './composition-context'
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

export function useUpdateExternalContact() {
  const context = useContactsFeatureContext()
  const repository = useContactsManagementRepository()
  const queryClient = useQueryClient()

  return useMutation(
    mutationOptions({
      mutationFn: (command: UpdateExternalContactCommand) =>
        repository.updateExternalContact(command),
      onSuccess: (result) => {
        if (result.kind !== 'updated') return
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
      mutationFn: (command: AddPlatformContactsCommand) => repository.addPlatformContacts(command),
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

export function useOptionalMemberInviteContactUpgrade() {
  const contactsManagement = useOptionalContactsManagement()
  const queryClient = useQueryClient()
  const findConflicts = useMutation(
    mutationOptions({
      mutationFn: async (command: FindExternalContactsByEmailsCommand) => {
        if (!contactsManagement.repository) return []
        return contactsManagement.repository.findExternalContactsByEmails(command)
      },
    }),
  )
  const upgradeContacts = useMutation(
    mutationOptions({
      mutationFn: async (command: UpgradeExternalContactsToWorkspaceCommand) => {
        if (!contactsManagement.repository) return { contactIds: [], kind: 'upgraded' as const }
        return contactsManagement.repository.upgradeExternalContactsToWorkspace(command)
      },
      onSuccess: (result) => {
        if (!contactsManagement.context || result.contactIds.length === 0) return
        void queryClient.invalidateQueries({
          queryKey: contactsManagementQueryKeys.all(contactsManagement.context.workspaceId),
        })
      },
    }),
  )

  return {
    available: Boolean(contactsManagement.context && contactsManagement.repository),
    findConflicts: findConflicts.mutateAsync,
    isChecking: findConflicts.isPending,
    isUpgrading: upgradeContacts.isPending,
    upgradeContacts: upgradeContacts.mutateAsync,
  }
}
