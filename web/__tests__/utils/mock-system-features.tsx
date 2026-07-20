import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import type {
  RenderHookOptions,
  RenderHookResult,
  RenderOptions,
  RenderResult,
} from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, renderHook } from '@testing-library/react'
import { defaultSystemFeatures } from '@/features/system-features/config'
import { consoleQuery } from '@/service/client'

type QueryKeyProvider = {
  queryKey: () => readonly unknown[]
}

type TrialModelsQueryProvider = {
  get?: QueryKeyProvider
}

type AppDslVersionQueryProvider = {
  get?: QueryKeyProvider
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

type DeepPartial<T> =
  T extends Array<infer U>
    ? Array<U>
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T

const buildSystemFeatures = (
  overrides: DeepPartial<GetSystemFeaturesResponse> = {},
): GetSystemFeaturesResponse => {
  const o = overrides as Partial<GetSystemFeaturesResponse>
  return {
    ...defaultSystemFeatures,
    ...o,
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
export const createTestQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: Infinity,
        queryFn: () => new Promise(() => {}),
      },
      mutations: { retry: false },
    },
  })

export const seedSystemFeatures = (
  queryClient: QueryClient,
  overrides: DeepPartial<GetSystemFeaturesResponse> = {},
): GetSystemFeaturesResponse => {
  const data = buildSystemFeatures(overrides)
  queryClient.setQueryData(consoleQuery.systemFeatures.get.queryKey(), data)
  return data
}

const seedTrialModels = (queryClient: QueryClient, trialModels: readonly string[] = []) => {
  queryClient.setQueryData(getTrialModelsQueryKey(), { trial_models: [...trialModels] })
}

export const seedAppDslVersion = (queryClient: QueryClient, appDslVersion = '0.6.0') => {
  queryClient.setQueryData(getAppDslVersionQueryKey(), { app_dsl_version: appDslVersion })
}

type SystemFeaturesTestOptions = {
  /**
   * Partial overrides for the systemFeatures payload. When omitted, the cache
   * is seeded with `defaultSystemFeatures` so consumers using
   * `useSuspenseQuery` resolve immediately. Pass `null` to skip seeding and
   * keep the systemFeatures query in the pending state.
   */
  systemFeatures?: DeepPartial<GetSystemFeaturesResponse> | null
  trialModels?: readonly string[] | null
  /**
   * Seed the workflow clipboard DSL version query only for tests that need it.
   * Omit or pass `null` to leave it unseeded.
   */
  appDslVersion?: string | null
  queryClient?: QueryClient
}

type SystemFeaturesWrapper = {
  queryClient: QueryClient
  systemFeatures: GetSystemFeaturesResponse | null
  wrapper: (props: { children: ReactNode }) => ReactElement
}

export const createSystemFeaturesWrapper = (
  options: SystemFeaturesTestOptions = {},
): SystemFeaturesWrapper => {
  const queryClient = options.queryClient ?? createTestQueryClient()
  const systemFeatures =
    options.systemFeatures === null ? null : seedSystemFeatures(queryClient, options.systemFeatures)
  if (options.trialModels !== undefined && options.trialModels !== null)
    seedTrialModels(queryClient, options.trialModels)
  if (options.appDslVersion !== undefined && options.appDslVersion !== null)
    seedAppDslVersion(queryClient, options.appDslVersion)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, systemFeatures, wrapper }
}

export const renderWithSystemFeatures = (
  ui: ReactElement,
  options: SystemFeaturesTestOptions & Omit<RenderOptions, 'wrapper'> = {},
): RenderResult & {
  queryClient: QueryClient
  systemFeatures: GetSystemFeaturesResponse | null
} => {
  const {
    systemFeatures: sf,
    trialModels,
    appDslVersion,
    queryClient: qc,
    ...renderOptions
  } = options
  const { wrapper, queryClient, systemFeatures } = createSystemFeaturesWrapper({
    systemFeatures: sf,
    trialModels,
    appDslVersion,
    queryClient: qc,
  })
  const rendered = render(ui, { wrapper, ...renderOptions })
  return { ...rendered, queryClient, systemFeatures }
}

export const renderHookWithSystemFeatures = <Result, Props = void>(
  callback: (props: Props) => Result,
  options: SystemFeaturesTestOptions & Omit<RenderHookOptions<Props>, 'wrapper'> = {},
): RenderHookResult<Result, Props> & {
  queryClient: QueryClient
  systemFeatures: GetSystemFeaturesResponse | null
} => {
  const {
    systemFeatures: sf,
    trialModels,
    appDslVersion,
    queryClient: qc,
    ...hookOptions
  } = options
  const { wrapper, queryClient, systemFeatures } = createSystemFeaturesWrapper({
    systemFeatures: sf,
    trialModels,
    appDslVersion,
    queryClient: qc,
  })
  const rendered = renderHook(callback, { wrapper, ...hookOptions })
  return { ...rendered, queryClient, systemFeatures }
}
