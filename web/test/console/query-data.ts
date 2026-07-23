import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import type { PostWorkspacesCurrentResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import type {
  RenderHookOptions,
  RenderHookResult,
  RenderOptions,
  RenderResult,
} from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { render, renderHook } from '@testing-library/react'
import { defaultSystemFeatures } from '@/features/system-features/config'
import type { SystemFeatures } from '@/features/system-features/config'
import { consoleQuery } from '@/service/client'
import { ensureAccountProfileQuery, seedAccountProfileQuery } from '@/test/console/account-profile'
import {
  currentWorkspaceQueryKey,
  ensureCurrentWorkspaceQuery,
  seedCurrentWorkspaceQuery,
} from '@/test/console/current-workspace'
import { createQueryClientWrapper } from '@/test/console/query-client'
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

type DeepPartial<T> =
  T extends Array<infer U>
    ? Array<U>
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T

const buildSystemFeatures = (
  overrides: DeepPartial<SystemFeatures> = {},
): SystemFeatures => {
  const o = overrides as Partial<SystemFeatures>
  return {
    ...defaultSystemFeatures,
    ...o,
    deployment_edition:
      'deployment_edition' in o ? (o.deployment_edition ?? null) : 'COMMUNITY',
    branding: {
      ...defaultSystemFeatures.branding,
      ...(o.branding ?? {}),
    },
    webapp_auth: {
      ...defaultSystemFeatures.webapp_auth,
      ...(o.webapp_auth ?? {}),
      sso_config: {
        ...defaultSystemFeatures.webapp_auth.sso_config,
        ...(o.webapp_auth?.sso_config ?? {}),
      },
    },
    plugin_installation_permission: {
      ...defaultSystemFeatures.plugin_installation_permission,
      ...(o.plugin_installation_permission ?? {}),
    },
    license: {
      ...defaultSystemFeatures.license,
      ...(o.license ?? {}),
      workspaces: {
        ...defaultSystemFeatures.license.workspaces,
        ...(o.license?.workspaces ?? {}),
      },
    },
    plugin_manager: {
      ...defaultSystemFeatures.plugin_manager,
      ...(o.plugin_manager ?? {}),
    },
  }
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
  overrides: DeepPartial<SystemFeatures> = {},
): SystemFeatures => {
  const data = buildSystemFeatures(overrides)
  const queryKey = consoleQuery.systemFeatures.get.queryKey() as readonly unknown[]
  queryClient.setQueryData<SystemFeatures>(queryKey, data)
  return data
}

const ensureSystemFeatures = (queryClient: QueryClient) => {
  const queryKey = consoleQuery.systemFeatures.get.queryKey()
  const existingSystemFeatures = queryClient.getQueryData<SystemFeatures>(queryKey)
  if (existingSystemFeatures === undefined) return seedSystemFeatures(queryClient)

  return existingSystemFeatures
}

const seedPendingSystemFeatures = (queryClient: QueryClient) => {
  void queryClient.prefetchQuery({
    queryKey: consoleQuery.systemFeatures.get.queryKey(),
    queryFn: () => new Promise<SystemFeatures>(() => {}),
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
   * is seeded with `defaultSystemFeatures` so consumers using
   * `useSuspenseQuery` resolve immediately. Pass `null` to skip seeding and
   * keep the systemFeatures query in the pending state.
   */
  systemFeatures?: DeepPartial<SystemFeatures> | null
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
  systemFeatures: SystemFeatures | null
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
  systemFeatures: SystemFeatures | null
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
  systemFeatures: SystemFeatures | null
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
