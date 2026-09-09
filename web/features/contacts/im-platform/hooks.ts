'use client'

import type { ContactImPlatformRepository } from './repository'
import type {
  AuthorizeContactImProviderCommand,
  ContactImProviderCommand,
  ContactImSyncResult,
  ContactImSyncRunView,
  SaveContactImCredentialsCommand,
  TestContactImConnectionCommand,
} from './types'
import {
  queryOptions,
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import {
  invalidateHumanInputChannelQueries,
  invalidateHumanInputContactQueries,
} from '@/service/client'
import {
  useContactsImPlatformOrganization,
  useContactsImPlatformRepository,
} from './composition-context'
import { contactImPlatformQueryKeys } from './query-keys'
import {
  ContactImRepositoryError,
  ContactImRepositoryErrorCode,
  ContactImSyncStatus,
} from './types'

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
  workspaceId: string,
) => ({
  enabled: Boolean(workspaceId),
  queryFn: () => repository.getActiveSync(organizationId),
  queryKey: [
    ...contactImPlatformQueryKeys.activeSync(organizationId, repository.queryKey),
    { workspaceId },
    repository,
  ] as const,
})

const getSyncRunQueryOptions = (
  repository: ContactImPlatformRepository,
  workspaceId: string,
  runId: string | null,
) =>
  queryOptions({
    enabled: Boolean(workspaceId && runId),
    queryFn: runId ? () => repository.getSyncRun(runId) : skipToken,
    queryKey: [
      ...contactImPlatformQueryKeys.syncRun(runId ?? 'none', repository.queryKey),
      { workspaceId },
      repository,
    ] as const,
  })

const getSyncItemsQueryOptions = (
  repository: ContactImPlatformRepository,
  {
    enabled,
    workspaceId,
    pageSize,
    result,
    runId,
  }: {
    enabled: boolean
    workspaceId: string
    pageSize: number
    result?: ContactImSyncResult
    runId: string
  },
) => ({
  enabled: enabled && Boolean(workspaceId),
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
    { workspaceId },
    repository,
  ] as const,
})

export const useContactImIntegrations = () => {
  const organization = useContactsImPlatformOrganization()
  const repository = useContactsImPlatformRepository()

  return useQuery({
    ...getIntegrationsQueryOptions(repository, organization.organizationId),
    enabled: Boolean(
      organization.organizationId && organization.workspaceId && organization.canManage,
    ),
  })
}

export const useContactImProviderDefinitions = () => {
  const organization = useContactsImPlatformOrganization()
  const repository = useContactsImPlatformRepository()

  return useQuery({
    ...getProviderDefinitionsQueryOptions(repository, organization.organizationId),
    enabled: Boolean(
      organization.organizationId && organization.workspaceId && organization.canManage,
    ),
  })
}

const useRefreshCompletedContactImSync = (run: ContactImSyncRunView | null | undefined) => {
  const organization = useContactsImPlatformOrganization()
  const repository = useContactsImPlatformRepository()
  const queryClient = useQueryClient()
  const refreshedRunRef = useRef<string | null>(null)

  useEffect(() => {
    if (
      !organization.canManage ||
      !organization.workspaceId ||
      !organization.organizationId ||
      !run ||
      isActiveSyncStatus(run.status)
    )
      return
    const completedRunKey = `${organization.workspaceId}:${run.id}:${run.status}`
    if (refreshedRunRef.current === completedRunKey) return
    refreshedRunRef.current = completedRunKey

    void Promise.all([
      invalidateHumanInputContactQueries(queryClient, organization.workspaceId),
      queryClient.invalidateQueries({
        queryKey: contactImPlatformQueryKeys.integrations(
          organization.organizationId,
          repository.queryKey,
        ),
      }),
      queryClient.invalidateQueries({
        queryKey: [...contactImPlatformQueryKeys.syncRun(run.id, repository.queryKey), 'items'],
      }),
    ])
  }, [
    organization.canManage,
    organization.organizationId,
    organization.workspaceId,
    run,
    queryClient,
    repository.queryKey,
  ])
}

export const useContactImActiveSync = () => {
  const organization = useContactsImPlatformOrganization()
  const repository = useContactsImPlatformRepository()
  const query = useQuery({
    ...getActiveSyncQueryOptions(repository, organization.organizationId, organization.workspaceId),
    enabled: Boolean(
      organization.canManage && organization.workspaceId && organization.organizationId,
    ),
    refetchInterval: ({ state }) =>
      isActiveSyncStatus(state.data?.status) ? CONTACT_IM_SYNC_POLL_INTERVAL_MS : false,
  })
  useRefreshCompletedContactImSync(query.data)
  return query
}

export const useContactImSyncRun = (runId: string | null) => {
  const organization = useContactsImPlatformOrganization()
  const repository = useContactsImPlatformRepository()
  const query = useQuery({
    ...getSyncRunQueryOptions(repository, organization.workspaceId, runId),
    enabled: Boolean(
      organization.canManage && organization.workspaceId && organization.organizationId && runId,
    ),
    refetchInterval: ({ state }) =>
      isActiveSyncStatus(state.data?.status) ? CONTACT_IM_SYNC_POLL_INTERVAL_MS : false,
  })
  useRefreshCompletedContactImSync(query.data)
  return query
}

export const useContactImSyncItems = ({
  enabled = true,
  pageSize = 20,
  result,
  runId,
}: {
  enabled?: boolean
  pageSize?: number
  result?: ContactImSyncResult
  runId: string
}) => {
  const organization = useContactsImPlatformOrganization()
  const repository = useContactsImPlatformRepository()

  return useInfiniteQuery(
    getSyncItemsQueryOptions(repository, {
      enabled: enabled && organization.canManage && Boolean(organization.organizationId),
      workspaceId: organization.workspaceId,
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
      invalidateHumanInputChannelQueries(queryClient, organization.workspaceId),
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
    mutationFn: () => {
      if (!organization.canManage || !organization.workspaceId || !organization.organizationId)
        throw new ContactImRepositoryError(ContactImRepositoryErrorCode.NoPermission)
      return repository.startSync({ organizationId: organization.organizationId })
    },
    onMutate: () => ({ organization, repository }),
    onSuccess: async (run, _variables, context) => {
      if (!context) return
      const { organization: currentOrganization, repository: currentRepository } = context
      queryClient.setQueryData(
        getActiveSyncQueryOptions(
          currentRepository,
          currentOrganization.organizationId,
          currentOrganization.workspaceId,
        ).queryKey,
        run,
      )
      queryClient.setQueryData(
        getSyncRunQueryOptions(currentRepository, currentOrganization.workspaceId, 'latest')
          .queryKey,
        run,
      )
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: contactImPlatformQueryKeys.activeSync(
            currentOrganization.organizationId,
            currentRepository.queryKey,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: contactImPlatformQueryKeys.integrations(
            currentOrganization.organizationId,
            currentRepository.queryKey,
          ),
        }),
      ])
    },
  })
}
