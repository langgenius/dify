import type { ConsolePolicies, ConsoleQuery } from './types'
import { addCreatedKeyToLists, invalidateQueryKeys } from './shared'

export function enterprisePolicies(consoleQuery: ConsoleQuery): ConsolePolicies['enterprise'] {
  return {
    appDeploy: {
      accessService: {
        updateEnvironmentApi: {
          mutationOptions: {
            onSuccess: async (updated, variables, _result, context) => {
              const { app_id, environment_id } = variables.params
              const accessKey =
                consoleQuery.enterprise.appDeploy.accessService.getEnvironmentApi.queryOptions({
                  input: { params: { app_id, environment_id } },
                }).queryKey
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
              // Reads started before the save must not overwrite what it writes.
              await Promise.all(
                [accessKey, list.queryKey, detail.queryKey].map((queryKey) =>
                  context.client.cancelQueries({ queryKey, exact: true }),
                ),
              )
              context.client.setQueryData(accessKey, updated)
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
            onSuccess: async (updated, variables, _result, context) => {
              const { app_id, environment_id } = variables.params
              const accessKey =
                consoleQuery.enterprise.appDeploy.accessService.getEnvironmentSite.queryOptions({
                  input: { params: { app_id, environment_id } },
                }).queryKey
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
              // Reads started before the save must not overwrite what it writes.
              await Promise.all(
                [accessKey, list.queryKey, detail.queryKey].map((queryKey) =>
                  context.client.cancelQueries({ queryKey, exact: true }),
                ),
              )
              context.client.setQueryData(accessKey, updated)
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
            onSuccess: async (site, { params }, _result, { client }) => {
              const input = {
                params: { app_id: params.app_id, environment_id: params.environment_id },
              }
              const siteKey =
                consoleQuery.enterprise.appDeploy.accessService.getEnvironmentSite.queryKey({
                  input,
                })
              if (client.isFetching({ queryKey: siteKey, exact: true }))
                await client.cancelQueries({ queryKey: siteKey, exact: true })
              client.setQueryData(siteKey, site)
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
            onSuccess: async (site, { params }, _result, { client }) => {
              const siteKey =
                consoleQuery.enterprise.appDeploy.accessService.getEnvironmentSite.queryKey({
                  input: {
                    params: { app_id: params.app_id, environment_id: params.environment_id },
                  },
                })
              if (client.isFetching({ queryKey: siteKey, exact: true }))
                await client.cancelQueries({ queryKey: siteKey, exact: true })
              client.setQueryData(siteKey, site)
            },
          },
        },
        createEnvironmentApiKey: {
          mutationOptions: {
            // Writes the new key into its list, so the one-time secret shows at once.
            onSuccess: async (created, variables, _result, context) => {
              const listKey =
                consoleQuery.enterprise.appDeploy.accessService.listEnvironmentApiKeys.queryKey({
                  input: { params: variables.params },
                })
              return addCreatedKeyToLists(context.client, listKey, created)
            },
          },
        },
        deleteEnvironmentApiKey: {
          mutationOptions: {
            // Waits for the key list it deletes from.
            onSuccess: (_data, variables, _result, context) =>
              invalidateQueryKeys(context.client, [
                consoleQuery.enterprise.appDeploy.accessService.listEnvironmentApiKeys.queryKey({
                  input: { params: variables.params },
                }),
              ]),
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
      },
    },
    webAppAuth: {
      updateWebAppWhitelistSubjects: {
        mutationOptions: {
          meta: { alsoInvalidate: ['apps'] },
          // The access dialog reopens with the access mode and subjects from these queries
          // (the app or agent detail shows the mode), so the save waits for them.
          onSuccess: (_data, _variables, _result, context) =>
            invalidateQueryKeys(context.client, [
              consoleQuery.enterprise.webAppAuth.getWebAppAccessMode.key(),
              consoleQuery.enterprise.webAppAuth.getWebAppWhitelistSubjects.key(),
              consoleQuery.apps.byAppId.get.key(),
              consoleQuery.agent.byAgentId.get.key(),
            ]),
        },
      },
    },
  }
}
