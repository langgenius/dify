import type { ConsolePolicies, ConsoleQuery } from './types'

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
              return Promise.all([
                context.client.invalidateQueries({ queryKey: list.queryKey }),
                context.client.invalidateQueries({ queryKey: detail.queryKey }),
              ])
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
              return Promise.all([
                context.client.invalidateQueries({ queryKey: list.queryKey }),
                context.client.invalidateQueries({ queryKey: detail.queryKey }),
              ])
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
              void client.invalidateQueries({
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
        createEnvironmentApiKey: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) => {
              const { app_id, environment_id } = variables.params
              return Promise.all([
                context.client.invalidateQueries({
                  queryKey:
                    consoleQuery.enterprise.appDeploy.accessService.listEnvironmentApiKeys.queryKey(
                      {
                        input: { params: { app_id, environment_id } },
                      },
                    ),
                }),
                context.client.invalidateQueries({
                  queryKey:
                    consoleQuery.enterprise.appDeploy.accessService.getEnvironmentApi.queryKey({
                      input: { params: { app_id, environment_id } },
                    }),
                }),
              ])
            },
          },
        },
        deleteEnvironmentApiKey: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) => {
              const { app_id, environment_id } = variables.params
              return Promise.all([
                context.client.invalidateQueries({
                  queryKey:
                    consoleQuery.enterprise.appDeploy.accessService.listEnvironmentApiKeys.queryKey(
                      {
                        input: { params: { app_id, environment_id } },
                      },
                    ),
                }),
                context.client.invalidateQueries({
                  queryKey:
                    consoleQuery.enterprise.appDeploy.accessService.getEnvironmentApi.queryKey({
                      input: { params: { app_id, environment_id } },
                    }),
                }),
              ])
            },
          },
        },
      },
      deploymentService: {
        deployWorkflow: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) => {
              const { app_id, environment_id } = variables.params
              return Promise.all([
                context.client.invalidateQueries({
                  queryKey:
                    consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryKey(
                      {
                        input: { params: { app_id } },
                      },
                    ),
                }),
                context.client.invalidateQueries({
                  queryKey:
                    consoleQuery.enterprise.appDeploy.deploymentService.getEnvironmentDeployment.queryKey(
                      {
                        input: { params: { app_id, environment_id } },
                      },
                    ),
                }),
              ])
            },
          },
        },
        undeployWorkflow: {
          mutationOptions: {
            onSuccess: (_data, variables, _result, context) => {
              const { app_id, environment_id } = variables.params
              return Promise.all([
                context.client.invalidateQueries({
                  queryKey:
                    consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryKey(
                      {
                        input: { params: { app_id } },
                      },
                    ),
                }),
                context.client.invalidateQueries({
                  queryKey:
                    consoleQuery.enterprise.appDeploy.deploymentService.getEnvironmentDeployment.queryKey(
                      {
                        input: { params: { app_id, environment_id } },
                      },
                    ),
                }),
                context.client.invalidateQueries({
                  queryKey:
                    consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryKey(
                      {
                        input: { params: { app_id } },
                      },
                    ),
                }),
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
            void context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
            void context.client.invalidateQueries({
              queryKey: consoleQuery.apps.starred.get.key(),
            })
            void context.client.invalidateQueries({
              queryKey: consoleQuery.apps.recent.get.key(),
            })

            return Promise.all([
              context.client.invalidateQueries({
                queryKey: consoleQuery.enterprise.webAppAuth.getWebAppAccessMode.key(),
              }),
              context.client.invalidateQueries({
                queryKey: consoleQuery.enterprise.webAppAuth.getWebAppWhitelistSubjects.key(),
              }),
              context.client.invalidateQueries({
                queryKey: consoleQuery.agent.byAgentId.get.key(),
              }),
            ])
          },
        },
      },
    },
  }
}
