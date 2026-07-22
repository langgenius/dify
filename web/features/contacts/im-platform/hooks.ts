'use client'

import type { ContactImPlatformRepository } from './repository'
import type {
  AuthorizeContactImProviderCommand,
  ContactImProviderCommand,
  ContactImSyncResult,
  SaveContactImCredentialsCommand,
  TestContactImConnectionCommand,
} from './types'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import {
  useContactsImPlatformOrganization,
  useContactsImPlatformRepository,
} from './composition-context'
import { contactImPlatformQueryKeys } from './query-keys'
import { ContactImSyncStatus } from './types'

type SaveCredentialsInput = Omit<SaveContactImCredentialsCommand, 'organizationId'>
type AuthorizeProviderInput = Omit<AuthorizeContactImProviderCommand, 'organizationId'>
type ProviderInput = Omit<ContactImProviderCommand, 'organizationId'>
type TestConnectionInput = Omit<TestContactImConnectionCommand, 'organizationId'>

export const CONTACT_IM_SYNC_POLL_INTERVAL_MS = 2_000

const isActiveSyncStatus = (status: ContactImSyncStatus | undefined) =>
  status === ContactImSyncStatus.Queued || status === ContactImSyncStatus.Running

const getIntegrationsQueryOptions = (
  repository: ContactImPlatformRepository,
  organizationId: string,
) => ({
  queryFn: () => repository.getIntegrations(organizationId),
  queryKey: [
    ...contactImPlatformQueryKeys.integrations(organizationId, repository.queryKey),
    repository,
  ] as const,
})

const getProviderDefinitionsQueryOptions = (
  repository: ContactImPlatformRepository,
  organizationId: string,
) => ({
  queryFn: () => repository.getProviderDefinitions(organizationId),
  queryKey: [
    ...contactImPlatformQueryKeys.providers(organizationId, repository.queryKey),
    repository,
  ] as const,
})

const getActiveSyncQueryOptions = (
  repository: ContactImPlatformRepository,
  organizationId: string,
) => ({
  queryFn: () => repository.getActiveSync(organizationId),
  queryKey: [
    ...contactImPlatformQueryKeys.activeSync(organizationId, repository.queryKey),
    repository,
  ] as const,
})

const getSyncRunQueryOptions = (repository: ContactImPlatformRepository, runId: string | null) => ({
  enabled: Boolean(runId),
  queryFn: () => repository.getSyncRun(runId as string),
  queryKey: [
    ...contactImPlatformQueryKeys.syncRun(runId ?? 'none', repository.queryKey),
    repository,
  ] as const,
})

const getSyncItemsQueryOptions = (
  repository: ContactImPlatformRepository,
  {
    pageSize,
    result,
    runId,
  }: {
    pageSize: number
    result?: ContactImSyncResult
    runId: string
  },
) => ({
  getNextPageParam: (lastPage: Awaited<ReturnType<ContactImPlatformRepository['getSyncItems']>>) =>
    lastPage.nextCursor ?? undefined,
  initialPageParam: undefined as string | undefined,
  queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
    repository.getSyncItems({
      cursor: pageParam,
      pageSize,
      result,
      runId,
    }),
  queryKey: [
    ...contactImPlatformQueryKeys.syncItems(runId, repository.queryKey, result, pageSize),
    repository,
  ] as const,
})

export const useContactImIntegrations = () => {
  const organization = useContactsImPlatformOrganization()
  const repository = useContactsImPlatformRepository()

  return useQuery(getIntegrationsQueryOptions(repository, organization.organizationId))
}

export const useContactImProviderDefinitions = () => {
  const organization = useContactsImPlatformOrganization()
  const repository = useContactsImPlatformRepository()

  return useQuery(getProviderDefinitionsQueryOptions(repository, organization.organizationId))
}

export const useContactImActiveSync = () => {
  const organization = useContactsImPlatformOrganization()
  const repository = useContactsImPlatformRepository()

  return useQuery(getActiveSyncQueryOptions(repository, organization.organizationId))
}

export const useContactImSyncRun = (runId: string | null) => {
  const organization = useContactsImPlatformOrganization()
  const repository = useContactsImPlatformRepository()
  const queryClient = useQueryClient()
  const refreshedTerminalRunIdRef = useRef<string | null>(null)
  const query = useQuery({
    ...getSyncRunQueryOptions(repository, runId),
    refetchInterval: ({ state }) =>
      isActiveSyncStatus(state.data?.status) ? CONTACT_IM_SYNC_POLL_INTERVAL_MS : false,
  })

  useEffect(() => {
    const run = query.data

    if (!run || isActiveSyncStatus(run.status) || refreshedTerminalRunIdRef.current === run.id)
      return

    refreshedTerminalRunIdRef.current = run.id
    void Promise.all([
      queryClient.invalidateQueries({
        queryKey: contactImPlatformQueryKeys.integrations(
          organization.organizationId,
          repository.queryKey,
        ),
      }),
      queryClient.invalidateQueries({
        queryKey: contactImPlatformQueryKeys.activeSync(
          organization.organizationId,
          repository.queryKey,
        ),
      }),
      queryClient.invalidateQueries({
        queryKey: [...contactImPlatformQueryKeys.syncRun(run.id, repository.queryKey), 'items'],
      }),
    ])
  }, [organization.organizationId, query.data, queryClient, repository, repository.queryKey])

  return query
}

export const useContactImSyncItems = ({
  pageSize = 20,
  result,
  runId,
}: {
  pageSize?: number
  result?: ContactImSyncResult
  runId: string
}) => {
  const repository = useContactsImPlatformRepository()

  return useInfiniteQuery(
    getSyncItemsQueryOptions(repository, {
      pageSize,
      result,
      runId,
    }),
  )
}

const useInvalidateOrganizationQueries = () => {
  const organization = useContactsImPlatformOrganization()
  const repository = useContactsImPlatformRepository()
  const queryClient = useQueryClient()

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: contactImPlatformQueryKeys.integrations(
          organization.organizationId,
          repository.queryKey,
        ),
      }),
      queryClient.invalidateQueries({
        queryKey: contactImPlatformQueryKeys.activeSync(
          organization.organizationId,
          repository.queryKey,
        ),
      }),
    ])
  }
}

export const useSaveContactImCredentials = () => {
  const organization = useContactsImPlatformOrganization()
  const repository = useContactsImPlatformRepository()
  const invalidateOrganizationQueries = useInvalidateOrganizationQueries()
  const commandRef = useRef<SaveCredentialsInput | null>(null)
  const inFlightRef = useRef(false)

  const mutation = useMutation({
    mutationFn: () => {
      const input = commandRef.current
      commandRef.current = null

      if (!input) throw new Error('Contact IM credential command is required')

      return repository.saveCredentials({
        ...input,
        organizationId: organization.organizationId,
      })
    },
    onSuccess: invalidateOrganizationQueries,
  })

  const saveCredentials = async (input: SaveCredentialsInput) => {
    if (inFlightRef.current) throw new Error('Contact IM credential save is already running')

    inFlightRef.current = true
    commandRef.current = input

    try {
      return await mutation.mutateAsync()
    } finally {
      commandRef.current = null
      inFlightRef.current = false
    }
  }

  return {
    ...mutation,
    saveCredentials,
  }
}

export const useAuthorizeContactImProvider = () => {
  const organization = useContactsImPlatformOrganization()
  const repository = useContactsImPlatformRepository()
  const invalidateOrganizationQueries = useInvalidateOrganizationQueries()

  return useMutation({
    mutationFn: (input: AuthorizeProviderInput) =>
      repository.authorizeProvider({
        ...input,
        organizationId: organization.organizationId,
      }),
    onSuccess: invalidateOrganizationQueries,
  })
}

export const useTestContactImConnection = () => {
  const organization = useContactsImPlatformOrganization()
  const repository = useContactsImPlatformRepository()
  const invalidateOrganizationQueries = useInvalidateOrganizationQueries()
  const commandRef = useRef<TestConnectionInput | null>(null)
  const inFlightRef = useRef(false)

  const mutation = useMutation({
    mutationFn: () => {
      const input = commandRef.current
      commandRef.current = null

      if (!input) throw new Error('Contact channel connection-test command is required')

      return repository.testConnection({
        ...input,
        organizationId: organization.organizationId,
      })
    },
    onSuccess: invalidateOrganizationQueries,
  })

  const testConnection = async (input: TestConnectionInput) => {
    if (inFlightRef.current) throw new Error('Contact channel connection test is already running')

    inFlightRef.current = true
    commandRef.current = input

    try {
      return await mutation.mutateAsync()
    } finally {
      commandRef.current = null
      inFlightRef.current = false
    }
  }

  return {
    ...mutation,
    testConnection,
  }
}

export const useDisconnectContactImProvider = () => {
  const organization = useContactsImPlatformOrganization()
  const repository = useContactsImPlatformRepository()
  const invalidateOrganizationQueries = useInvalidateOrganizationQueries()

  return useMutation({
    mutationFn: (input: ProviderInput) =>
      repository.disconnect({ ...input, organizationId: organization.organizationId }),
    onSuccess: invalidateOrganizationQueries,
  })
}

export const useStartContactImSync = () => {
  const organization = useContactsImPlatformOrganization()
  const repository = useContactsImPlatformRepository()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => repository.startSync({ organizationId: organization.organizationId }),
    onSuccess: async (run) => {
      queryClient.setQueryData(
        [...contactImPlatformQueryKeys.syncRun(run.id, repository.queryKey), repository],
        run,
      )
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: contactImPlatformQueryKeys.activeSync(
            organization.organizationId,
            repository.queryKey,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: contactImPlatformQueryKeys.integrations(
            organization.organizationId,
            repository.queryKey,
          ),
        }),
      ])
    },
  })
}
