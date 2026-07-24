import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import type {
  GetSystemFeaturesLicenseResponse,
  GetSystemFeaturesResponse,
} from '@dify/contracts/api/console/system-features/types.gen'
import type { PostWorkspacesCurrentResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import type {
  RenderHookOptions,
  RenderHookResult,
  RenderOptions,
  RenderResult,
} from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import type { DeepPartial } from '@/test/console/system-features'
import { render, renderHook } from '@testing-library/react'
import { consoleQuery } from '@/service/client'
import { ensureAccountProfileQuery, seedAccountProfileQuery } from '@/test/console/account-profile'
import {
  currentWorkspaceQueryKey,
  ensureCurrentWorkspaceQuery,
  seedCurrentWorkspaceQuery,
} from '@/test/console/current-workspace'
import { createQueryClientWrapper } from '@/test/console/query-client'
import {
  createSystemFeaturesFixture,
  createSystemFeaturesLicenseFixture,
} from '@/test/console/system-features'
import {
  ensureWorkspacePermissionsQuery,
  seedWorkspacePermissionsQuery,
} from '@/test/console/workspace-permissions'
import { createTestQueryClient } from '@/test/query-client'

type QueryKeyProvider = {
  queryKey: () => readonly unknown[]
}

type TrialModelsQueryProvider = {
  get?: QueryKeyProvider
}

type AppDslVersionQueryProvider = {
  get?: QueryKeyProvider
}

type CurrentWorkspaceQueryProvider = {
  post?: QueryKeyProvider
}

const fallbackTrialModelsQueryKey = ['console', 'trialModels', 'get'] as const
const fallbackAppDslVersionQueryKey = ['console', 'appDslVersion', 'get'] as const

const getTrialModelsQueryKey = () => {
  const trialModelsQuery = (consoleQuery as { trialModels?: TrialModelsQueryProvider }).trialModels

  return trialModelsQuery?.get?.queryKey() ?? fallbackTrialModelsQueryKey
}

const getAppDslVersionQueryKey = () => {
  const appDslVersionQuery = (consoleQuery as { appDslVersion?: AppDslVersionQueryProvider })
    .appDslVersion

  return appDslVersionQuery?.get?.queryKey() ?? fallbackAppDslVersionQueryKey
}

const getCurrentWorkspaceQueryKey = () => {
  const currentWorkspaceQuery = (
    consoleQuery as {
      workspaces?: { current?: CurrentWorkspaceQueryProvider }
    }
  ).workspaces?.current

  return currentWorkspaceQuery?.post?.queryKey() ?? currentWorkspaceQueryKey
}

/**
 * Build a QueryClient suitable for tests. Any unseeded query stays in the
 * "pending" state forever because the default queryFn never resolves; this
 * mirrors the behaviour of an in-flight network request without touching the
 * real fetch layer.
 */
export const createConsoleQueryClient = (): QueryClient =>
  createTestQueryClient(() => new Promise(() => {}))

export const seedSystemFeatures = (
  queryClient: QueryClient,
  overrides: DeepPartial<GetSystemFeaturesResponse> = {},
): GetSystemFeaturesResponse => {
  const data = createSystemFeaturesFixture(overrides)
  const queryKey = consoleQuery.systemFeatures.get.queryKey() as readonly unknown[]
  queryClient.setQueryData<GetSystemFeaturesResponse>(queryKey, data)
  return data
}

export const seedSystemFeaturesLicense = (
  queryClient: QueryClient,
  overrides: DeepPartial<GetSystemFeaturesLicenseResponse> = {},
): GetSystemFeaturesLicenseResponse => {
  const data = createSystemFeaturesLicenseFixture(overrides)
  const queryKey = consoleQuery.systemFeatures.license.get.queryOptions().queryKey
  queryClient.setQueryData<GetSystemFeaturesLicenseResponse>(queryKey, data)
  return data
}

const ensureSystemFeatures = (queryClient: QueryClient) => {
  const queryKey = consoleQuery.systemFeatures.get.queryKey()
  const existingSystemFeatures = queryClient.getQueryData<GetSystemFeaturesResponse>(queryKey)
  if (existingSystemFeatures === undefined) return seedSystemFeatures(queryClient)

  return existingSystemFeatures
}

const seedPendingSystemFeatures = (queryClient: QueryClient) => {
  void queryClient.prefetchQuery({
    queryKey: consoleQuery.systemFeatures.get.queryKey(),
    queryFn: () => new Promise<GetSystemFeaturesResponse>(() => {}),
  })
}

const seedTrialModels = (queryClient: QueryClient, trialModels: readonly string[] = []) => {
  queryClient.setQueryData(getTrialModelsQueryKey(), { trial_models: [...trialModels] })
}

const ensureTrialModels = (queryClient: QueryClient) => {
  const queryKey = getTrialModelsQueryKey()
  if (queryClient.getQueryData(queryKey) === undefined) seedTrialModels(queryClient)
}

export const seedAppDslVersion = (queryClient: QueryClient, appDslVersion = '0.6.0') => {
  queryClient.setQueryData(getAppDslVersionQueryKey(), { app_dsl_version: appDslVersion })
}

export type ConsoleQueryTestOptions = {
  /**
   * Partial overrides for the systemFeatures payload. When omitted, the cache
   * is seeded with a valid Community response so consumers using
   * `useSuspenseQuery` resolve immediately. Pass `null` to skip seeding and
   * keep the systemFeatures query in the pending state.
   */
  systemFeatures?: DeepPartial<GetSystemFeaturesResponse> | null
  accountProfile?: Partial<GetAccountProfileResponse> | null
  currentWorkspace?: Partial<PostWorkspacesCurrentResponse> | null
  trialModels?: readonly string[] | null
  workspacePermissionKeys?: readonly string[] | null
  /**
   * Seed the workflow clipboard DSL version query only for tests that need it.
   * Omit or pass `null` to leave it unseeded.
   */
  appDslVersion?: string | null
  queryClient?: QueryClient
}

type ConsoleQueryWrapper = {
  queryClient: QueryClient
  systemFeatures: GetSystemFeaturesResponse | null
  wrapper: (props: { children: ReactNode }) => ReactElement
}

export const createConsoleQueryWrapper = (
  options: ConsoleQueryTestOptions = {},
): ConsoleQueryWrapper => {
  const queryClient = options.queryClient ?? createConsoleQueryClient()
  if (options.accountProfile !== null) {
    if (options.accountProfile) seedAccountProfileQuery(queryClient, options.accountProfile)
    else ensureAccountProfileQuery(queryClient, { timezone: 'UTC' })
  }
  if (options.currentWorkspace !== null) {
    const queryKey = getCurrentWorkspaceQueryKey()
    if (options.currentWorkspace)
      seedCurrentWorkspaceQuery(queryClient, options.currentWorkspace, queryKey)
    else ensureCurrentWorkspaceQuery(queryClient, {}, queryKey)
  }
  if (options.workspacePermissionKeys !== null) {
    if (options.workspacePermissionKeys)
      seedWorkspacePermissionsQuery(queryClient, 'workspace-1', options.workspacePermissionKeys)
    else ensureWorkspacePermissionsQuery(queryClient)
  }
  const systemFeatures =
    options.systemFeatures === null
      ? null
      : options.systemFeatures
        ? seedSystemFeatures(queryClient, options.systemFeatures)
        : ensureSystemFeatures(queryClient)
  if (options.systemFeatures === null) seedPendingSystemFeatures(queryClient)
  if (options.trialModels !== null) {
    if (options.trialModels) seedTrialModels(queryClient, options.trialModels)
    else ensureTrialModels(queryClient)
  }
  if (options.appDslVersion !== undefined && options.appDslVersion !== null)
    seedAppDslVersion(queryClient, options.appDslVersion)
  const wrapper = createQueryClientWrapper(queryClient)
  return { queryClient, systemFeatures, wrapper }
}

export const renderWithConsoleQuery = (
  ui: ReactElement,
  options: ConsoleQueryTestOptions & Omit<RenderOptions, 'wrapper'> = {},
): RenderResult & {
  queryClient: QueryClient
  systemFeatures: GetSystemFeaturesResponse | null
} => {
  const {
    systemFeatures: sf,
    accountProfile,
    currentWorkspace,
    trialModels,
    workspacePermissionKeys,
    appDslVersion,
    queryClient: qc,
    ...renderOptions
  } = options
  const { wrapper, queryClient, systemFeatures } = createConsoleQueryWrapper({
    systemFeatures: sf,
    accountProfile,
    currentWorkspace,
    trialModels,
    workspacePermissionKeys,
    appDslVersion,
    queryClient: qc,
  })
  const rendered = render(ui, { wrapper, ...renderOptions })
  return { ...rendered, queryClient, systemFeatures }
}

export const renderHookWithConsoleQuery = <Result, Props = void>(
  callback: (props: Props) => Result,
  options: ConsoleQueryTestOptions & Omit<RenderHookOptions<Props>, 'wrapper'> = {},
): RenderHookResult<Result, Props> & {
  queryClient: QueryClient
  systemFeatures: GetSystemFeaturesResponse | null
} => {
  const {
    systemFeatures: sf,
    accountProfile,
    currentWorkspace,
    trialModels,
    workspacePermissionKeys,
    appDslVersion,
    queryClient: qc,
    ...hookOptions
  } = options
  const { wrapper, queryClient, systemFeatures } = createConsoleQueryWrapper({
    systemFeatures: sf,
    accountProfile,
    currentWorkspace,
    trialModels,
    workspacePermissionKeys,
    appDslVersion,
    queryClient: qc,
  })
  const rendered = renderHook(callback, { wrapper, ...hookOptions })
  return { ...rendered, queryClient, systemFeatures }
}
