import type { RenderHookOptions, RenderHookResult, RenderOptions, RenderResult } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import type { SystemFeatures } from '@/types/feature'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, renderHook } from '@testing-library/react'
import { consoleQuery } from '@/service/client'
import { defaultSystemFeatures } from '@/types/feature'

type DeepPartial<T> = T extends Array<infer U>
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
  overrides: DeepPartial<SystemFeatures> = {},
): SystemFeatures => {
  const data = buildSystemFeatures(overrides)
  queryClient.setQueryData(consoleQuery.systemFeatures.queryKey(), data)
  return data
}

type SystemFeaturesTestOptions = {
  /**
   * Partial overrides for the systemFeatures payload. When omitted, the cache
   * is seeded with `defaultSystemFeatures` so consumers using
   * `useSuspenseQuery` resolve immediately. Pass `null` to skip seeding and
   * keep the systemFeatures query in the pending state.
   */
  systemFeatures?: DeepPartial<SystemFeatures> | null
  queryClient?: QueryClient
}

type SystemFeaturesWrapper = {
  queryClient: QueryClient
  systemFeatures: SystemFeatures | null
  wrapper: (props: { children: ReactNode }) => ReactElement
}

export const createSystemFeaturesWrapper = (
  options: SystemFeaturesTestOptions = {},
): SystemFeaturesWrapper => {
  const queryClient = options.queryClient ?? createTestQueryClient()
  const systemFeatures = options.systemFeatures === null
    ? null
    : seedSystemFeatures(queryClient, options.systemFeatures)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, systemFeatures, wrapper }
}

export const renderWithSystemFeatures = (
  ui: ReactElement,
  options: SystemFeaturesTestOptions & Omit<RenderOptions, 'wrapper'> = {},
): RenderResult & { queryClient: QueryClient, systemFeatures: SystemFeatures | null } => {
  const { systemFeatures: sf, queryClient: qc, ...renderOptions } = options
  const { wrapper, queryClient, systemFeatures } = createSystemFeaturesWrapper({
    systemFeatures: sf,
    queryClient: qc,
  })
  const rendered = render(ui, { wrapper, ...renderOptions })
  return { ...rendered, queryClient, systemFeatures }
}

export const renderHookWithSystemFeatures = <Result, Props = void>(
  callback: (props: Props) => Result,
  options: SystemFeaturesTestOptions & Omit<RenderHookOptions<Props>, 'wrapper'> = {},
): RenderHookResult<Result, Props> & { queryClient: QueryClient, systemFeatures: SystemFeatures | null } => {
  const { systemFeatures: sf, queryClient: qc, ...hookOptions } = options
  const { wrapper, queryClient, systemFeatures } = createSystemFeaturesWrapper({
    systemFeatures: sf,
    queryClient: qc,
  })
  const rendered = renderHook(callback, { wrapper, ...hookOptions })
  return { ...rendered, queryClient, systemFeatures }
}
