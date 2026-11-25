import type { QueryClient } from '@tanstack/react-query'
import type { ConsolePolicies, ConsoleQuery } from './types'
import { invalidateQueryKeys } from './shared'

export function enterprisePolicies(consoleQuery: ConsoleQuery): ConsolePolicies['enterprise'] {
  return {
    appDeploy: {
      accessService: {
        updateEnvironmentApi: {
          mutationOptions: {
            onSuccess: (updated, variables, _result, context) => {
              const { app_id, environment_id } = variables.params
              context.client.setQueryData(
                consoleQuery.enterprise.appDeploy.accessService.getEnvironmentApi.queryOptions({
                  input: { params: { app_id, environment_id } },
                }).queryKey,
                updated,
              )
              const list =
                consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryOptions(
                  {
                    input: { params: { app_id } },
                  },
                )
              const detail =
                consoleQuery.enterprise.appDeploy.deploymentService.getEnvironmentDeployment.queryOptions(
                  {
                    input: { params: { app_id, environment_id } },
                  },
                )
              context.client.setQueryData(
                list.queryKey,
                (current) =>
                  current && {
                    ...current,
                    environment_deployments: current.environment_deployments.map((deployment) =>
                      deployment.environment.id === environment_id
                        ? {
                            ...deployment,
                            access: { ...deployment.access, enable_api: updated.enabled },
                          }
                        : deployment,
                    ),
                  },
              )
              context.client.setQueryData(
                detail.queryKey,
                (current) =>
                  current && {
                    ...current,
                    environment_deployment: {
                      ...current.environment_deployment,
                      access: {
                        ...current.environment_deployment.access,
                        enable_api: updated.enabled,
                      },
                    },
                  },
              )
              void invalidateQueryKeys(context.client, [list.queryKey, detail.queryKey])
            },
          },
        },
        updateEnvironmentSite: {
          mutationOptions: {
            onSuccess: (updated, variables, _result, context) => {
              const { app_id, environment_id } = variables.params
              context.client.setQueryData(
                consoleQuery.enterprise.appDeploy.accessService.getEnvironmentSite.queryOptions({
                  input: { params: { app_id, environment_id } },
                }).queryKey,
                updated,
              )
              const list =
                consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryOptions(
                  {
                    input: { params: { app_id } },
                  },
                )
              const detail =
                consoleQuery.enterprise.appDeploy.deploymentService.getEnvironmentDeployment.queryOptions(
                  {
                    input: { params: { app_id, environment_id } },
                  },
                )
              context.client.setQueryData(
                list.queryKey,
                (current) =>
                  current && {
                    ...current,
                    environment_deployments: current.environment_deployments.map((deployment) =>
                      deployment.environment.id === environment_id
                        ? {
                            ...deployment,
                            access: { ...deployment.access, enable_site: updated.enabled },
                          }
                        : deployment,
                    ),
                  },
              )
              context.client.setQueryData(
                detail.queryKey,
                (current) =>
                  current && {
                    ...current,
                    environment_deployment: {
                      ...current.environment_deployment,
                      access: {
                        ...current.environment_deployment.access,
                        enable_site: updated.enabled,
                      },
                    },
                  },
              )
              void invalidateQueryKeys(context.client, [list.queryKey, detail.queryKey])
            },
          },
        },
        updateEnvironmentWebAppAccessMode: {
          mutationOptions: {
            onSuccess: (site, { params }, _result, { client }) => {
              const input = {
                params: { app_id: params.app_id, environment_id: params.environment_id },
              }
              client.setQueryData(
                consoleQuery.enterprise.appDeploy.accessService.getEnvironmentSite.queryKey({
                  input,
                }),
                site,
              )
              // The site comes from the response; waits for the subjects the save may replace.
              return client.invalidateQueries({
                queryKey:
                  consoleQuery.enterprise.appDeploy.accessService.getEnvironmentWebAppSubjects.queryKey(
                    { input },
                  ),
              })
            },
          },
        },
        resetEnvironmentSiteAccessToken: {
          mutationOptions: {
            onSuccess: (site, { params }, _result, { client }) => {
              client.setQueryData(
                consoleQuery.enterprise.appDeploy.accessService.getEnvironmentSite.queryKey({
                  input: {
                    params: { app_id: params.app_id, environment_id: params.environment_id },
                  },
                }),
                site,
              )
            },
          },
        },
        // API key writes wait for the key list; the environment API settings refresh in the
        // background.
        createEnvironmentApiKey: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) =>
              invalidateEnvironmentApiKeyQueries(consoleQuery, context.client, variables.params),
          },
        },
        deleteEnvironmentApiKey: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) =>
              invalidateEnvironmentApiKeyQueries(consoleQuery, context.client, variables.params),
          },
        },
      },
      deploymentService: {
        deployWorkflow: {
          mutationOptions: {
            // Waits for the environment's deployment list and detail.
            onSuccess: (_data, variables, _result, context) => {
              const { app_id, environment_id } = variables.params
              return invalidateQueryKeys(context.client, [
                consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryKey(
                  { input: { params: { app_id } } },
                ),
                consoleQuery.enterprise.appDeploy.deploymentService.getEnvironmentDeployment.queryKey(
                  { input: { params: { app_id, environment_id } } },
                ),
              ])
            },
          },
        },
        undeployWorkflow: {
          mutationOptions: {
            // Waits for the environment's deployment list and detail; the app's environments
            // refresh in the background.
            onSuccess: (_data, variables, _result, context) => {
              const { app_id, environment_id } = variables.params
              void invalidateQueryKeys(context.client, [
                consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryKey({
                  input: { params: { app_id } },
                }),
              ])
              return invalidateQueryKeys(context.client, [
                consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryKey(
                  { input: { params: { app_id } } },
                ),
                consoleQuery.enterprise.appDeploy.deploymentService.getEnvironmentDeployment.queryKey(
                  { input: { params: { app_id, environment_id } } },
                ),
              ])
            },
          },
        },
      },
    },
    webAppAuth: {
      updateWebAppWhitelistSubjects: {
        mutationOptions: {
          onSuccess: (_data, _variables, _result, context) => {
            void invalidateQueryKeys(context.client, [
              consoleQuery.apps.get.key(),
              consoleQuery.apps.starred.get.key(),
              consoleQuery.apps.recent.get.key(),
            ])
            // The access dialog reopens with the access mode and subjects from these
            // queries (the agent detail on the agent page), so the save waits for them.
            return invalidateQueryKeys(context.client, [
              consoleQuery.enterprise.webAppAuth.getWebAppAccessMode.key(),
              consoleQuery.enterprise.webAppAuth.getWebAppWhitelistSubjects.key(),
              consoleQuery.agent.byAgentId.get.key(),
            ])
          },
        },
      },
    },
  }
}

function invalidateEnvironmentApiKeyQueries(
  query: ConsoleQuery,
  client: QueryClient,
  { app_id, environment_id }: { app_id: string; environment_id: string },
) {
  const input = { params: { app_id, environment_id } }
  const access = query.enterprise.appDeploy.accessService
  void invalidateQueryKeys(client, [access.getEnvironmentApi.queryKey({ input })])
  return invalidateQueryKeys(client, [access.listEnvironmentApiKeys.queryKey({ input })])
}
