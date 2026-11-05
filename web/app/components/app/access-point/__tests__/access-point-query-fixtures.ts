import type { QueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

export function seedAccessPointQueries(
  queryClient: QueryClient,
  appId: string,
  environments: string[],
) {
  const params = { app_id: appId }
  queryClient.setQueryData(consoleQuery.apps.byAppId.server.get.queryKey({ input: { params } }), {
    id: '',
    server_code: '',
    name: '',
    description: '',
    parameters: {},
    status: 'inactive',
  })
  queryClient.setQueryData(consoleQuery.apps.byAppId.triggers.get.queryKey({ input: { params } }), {
    data: [],
  })
  queryClient.setQueryData(consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} }), [])
  queryClient.setQueryData(
    consoleQuery.apps.byResourceId.apiKeys.get.queryKey({
      input: { params: { resource_id: appId } },
    }),
    { data: [] },
  )
  for (const environmentId of environments) {
    const input = { params: { ...params, environment_id: environmentId } }
    queryClient.setQueryData(
      consoleQuery.enterprise.appDeploy.accessService.getEnvironmentApi.queryKey({ input }),
      {
        api_key_count: 0,
        base_url: `https://${environmentId}.api.example.com/v1`,
        enabled: true,
      },
    )
    queryClient.setQueryData(
      consoleQuery.enterprise.appDeploy.accessService.getEnvironmentWebAppSubjects.queryKey({
        input,
      }),
      { subjects: [] },
    )
    queryClient.setQueryData(
      consoleQuery.enterprise.appDeploy.accessService.getEnvironmentSite.queryKey({ input }),
      {
        access_mode: 'private',
        app_base_url: `https://${environmentId}.example.com`,
        code: 'site-code',
        enabled: true,
      },
    )
  }
}
