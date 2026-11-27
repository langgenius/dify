import type {
  EventApiEntity,
  TriggerOAuthClientResponse,
  TriggerProviderApiEntity,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import {
  zEventApiEntity,
  zTriggerOAuthClientResponse,
  zTriggerProviderApiEntity,
} from '@dify/contracts/api/console/workspaces/zod.gen'
import { consoleQuery } from '@/service/console'

export const createTriggerEventResponseFixture = (overrides: Partial<EventApiEntity> = {}) => {
  const name = overrides.name ?? 'trigger_event'
  return zEventApiEntity.parse({
    name,
    identity: { author: 'Dify', name, label: { en_US: name } },
    description: { en_US: '' },
    parameters: [],
    output_schema: {},
    ...overrides,
  })
}

export const createTriggerProviderResponseFixture = (
  overrides: Partial<TriggerProviderApiEntity> = {},
) =>
  zTriggerProviderApiEntity.parse({
    author: 'Dify',
    name: 'trigger-provider',
    label: { en_US: 'Trigger Provider' },
    description: { en_US: '' },
    events: [],
    ...overrides,
  })

export const createTriggerOAuthConfigResponseFixture = (
  overrides: Partial<TriggerOAuthClientResponse> = {},
) =>
  zTriggerOAuthClientResponse.parse({
    configured: false,
    custom_configured: false,
    custom_enabled: false,
    oauth_client_schema: [],
    params: {},
    redirect_uri: '',
    system_configured: false,
    ...overrides,
  })

/** Seed the raw `GET /workspaces/current/triggers` response read by `allTriggerPluginsQueryOptions`. */
export function seedTriggerPlugins(
  queryClient: QueryClient,
  providers: ReturnType<typeof createTriggerProviderResponseFixture>[] = [],
) {
  queryClient.setQueryData(
    consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} }),
    providers,
  )
}
