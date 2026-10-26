import type {
  AgentAppComposerResponse,
  AgentAppPagination,
} from '@dify/contracts/api/console/agent/types.gen'
import type { ApiBasedExtensionResponse } from '@dify/contracts/api/console/api-based-extension/types.gen'
import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type {
  DatasetListResponse,
  DocumentWithSegmentsListResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { KnowledgeFsSpaceListResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import type { GetWorkflowRunArchivesResponse } from '@dify/contracts/api/console/workflow-run-archives/types.gen'
import type { AccountWithRoleListResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { experimental_RouterUtilsDefaults } from '@orpc/tanstack-query'
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query'
import type { ConsoleClient } from './index'
import type { ConsoleQueryKeys } from './query-keys'
import { getHttpErrorStatus, isNotFoundError } from '@/service/http-error'
import { consoleKeys as consoleQuery } from './query-keys'
import {
  legacyWorkflowVersionHistoryKey,
  syncAppWorkflowVersionCaches,
  syncWorkflowDeploymentCaches,
} from './workflow-version-cache'
type Defaults = experimental_RouterUtilsDefaults<ConsoleClient>
type PolicyAt<Path extends string[], Node = Defaults> = Path extends [
  infer Head extends keyof Node,
  ...infer Rest extends string[],
]
  ? PolicyAt<Rest, NonNullable<Node[Head]>>
  : Node

export const workflowRunArchives_downloads_post: PolicyAt<
  ['workflowRunArchives', 'downloads', 'post']
> = {
  mutationOptions: {
    onSuccess: (task, _variables, _onMutateResult, context) => {
      context.client.setQueryData(
        consoleQuery.workflowRunArchives.downloads.byDownloadId.get.queryKey({
          input: { params: { download_id: task.download_id } },
        }),
        task,
      )
    },
  },
}

export const workflowRunArchives_byYear_byMonth_delete: PolicyAt<
  ['workflowRunArchives', 'byYear', 'byMonth', 'delete']
> = {
  mutationOptions: {
    onSuccess: (task, _variables, _onMutateResult, context) => {
      const queryKey = consoleQuery.workflowRunArchives.get.queryKey()
      const deletionStatus = task.status
      context.client.setQueryData<GetWorkflowRunArchivesResponse>(queryKey, (data) => {
        if (!data) return data

        if (deletionStatus === 'completed') {
          const months = data.months.filter(
            (archive) => archive.year !== task.year || archive.month !== task.month,
          )
          return {
            months,
            summary: {
              archived_month_count: months.length,
              workflow_run_count: months.reduce(
                (count, archive) => count + archive.workflow_run_count,
                0,
              ),
              archive_bytes: months.reduce((bytes, archive) => bytes + archive.archive_bytes, 0),
              latest_archived_at: months.reduce<string | null>(
                (latest, archive) =>
                  archive.latest_archived_at && (!latest || archive.latest_archived_at > latest)
                    ? archive.latest_archived_at
                    : latest,
                null,
              ),
            },
          }
        }

        return {
          ...data,
          months: data.months.map((archive) =>
            archive.year === task.year && archive.month === task.month
              ? { ...archive, deletion_status: deletionStatus }
              : archive,
          ),
        }
      })
    },
    onSettled: (_data, _error, _variables, _onMutateResult, context) => {
      void context.client.invalidateQueries({
        queryKey: consoleQuery.workflowRunArchives.get.queryKey(),
      })
    },
  },
}

export const auth_plugin_datasource_list_get: PolicyAt<
  ['auth', 'plugin', 'datasource', 'list', 'get']
> = { queryOptions: { retry: false } }

export const auth_plugin_datasource_defaultList_get: PolicyAt<
  ['auth', 'plugin', 'datasource', 'defaultList', 'get']
> = { queryOptions: { retry: false } }

export const auth_plugin_datasource_byProviderId_post: PolicyAt<
  ['auth', 'plugin', 'datasource', 'byProviderId', 'post']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) =>
      Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.auth.plugin.datasource.byProviderId.get.key({
            input: { params: { provider_id: variables.params.provider_id } },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.auth.plugin.datasource.list.get.key(),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.auth.plugin.datasource.defaultList.get.key(),
        }),
      ]),
  },
}

export const auth_plugin_datasource_byProviderId_update_post: PolicyAt<
  ['auth', 'plugin', 'datasource', 'byProviderId', 'update', 'post']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) =>
      Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.auth.plugin.datasource.byProviderId.get.key({
            input: { params: { provider_id: variables.params.provider_id } },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.auth.plugin.datasource.list.get.key(),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.auth.plugin.datasource.defaultList.get.key(),
        }),
      ]),
  },
}

export const auth_plugin_datasource_byProviderId_customClient_post: PolicyAt<
  ['auth', 'plugin', 'datasource', 'byProviderId', 'customClient', 'post']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) =>
      Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.auth.plugin.datasource.byProviderId.get.key({
            input: { params: { provider_id: variables.params.provider_id } },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.auth.plugin.datasource.list.get.key(),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.auth.plugin.datasource.defaultList.get.key(),
        }),
      ]),
  },
}

export const auth_plugin_datasource_byProviderId_customClient_delete: PolicyAt<
  ['auth', 'plugin', 'datasource', 'byProviderId', 'customClient', 'delete']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) =>
      Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.auth.plugin.datasource.byProviderId.get.key({
            input: { params: { provider_id: variables.params.provider_id } },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.auth.plugin.datasource.list.get.key(),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.auth.plugin.datasource.defaultList.get.key(),
        }),
      ]),
  },
}

export const auth_plugin_datasource_byProviderId_get: PolicyAt<
  ['auth', 'plugin', 'datasource', 'byProviderId', 'get']
> = { queryOptions: { retry: false } }

export const auth_plugin_datasource_byProviderId_default_post: PolicyAt<
  ['auth', 'plugin', 'datasource', 'byProviderId', 'default', 'post']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) =>
      Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.auth.plugin.datasource.byProviderId.get.key({
            input: { params: { provider_id: variables.params.provider_id } },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.auth.plugin.datasource.list.get.key(),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.auth.plugin.datasource.defaultList.get.key(),
        }),
      ]),
  },
}

export const auth_plugin_datasource_byProviderId_delete_post: PolicyAt<
  ['auth', 'plugin', 'datasource', 'byProviderId', 'delete', 'post']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) =>
      Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.auth.plugin.datasource.byProviderId.get.key({
            input: { params: { provider_id: variables.params.provider_id } },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.auth.plugin.datasource.list.get.key(),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.auth.plugin.datasource.defaultList.get.key(),
        }),
      ]),
  },
}

export const notion_pages_byPageId_byPageType_preview_get: PolicyAt<
  ['notion', 'pages', 'byPageId', 'byPageType', 'preview', 'get']
> = {
  queryOptions: {
    context: { silent: true },
    retry: false,
    staleTime: 0,
  },
}

export const rag_pipeline_templates_byTemplateId_get: PolicyAt<
  ['rag', 'pipeline', 'templates', 'byTemplateId', 'get']
> = { queryOptions: { staleTime: 0 } }

export const rag_pipelines_datasourcePlugins_get: PolicyAt<
  ['rag', 'pipelines', 'datasourcePlugins', 'get']
> = {
  queryOptions: { staleTime: 0, retry: false },
}

export const rag_pipelines_imports_post: PolicyAt<['rag', 'pipelines', 'imports', 'post']> = {
  mutationOptions: { context: { silent: true } },
}

export const rag_pipelines_imports_byImportId_confirm_post: PolicyAt<
  ['rag', 'pipelines', 'imports', 'byImportId', 'confirm', 'post']
> = { mutationOptions: { context: { silent: true } } }

export const rag_pipelines_byPipelineId_workflowRuns_tasks_byTaskId_stop_post: PolicyAt<
  ['rag', 'pipelines', 'byPipelineId', 'workflowRuns', 'tasks', 'byTaskId', 'stop', 'post']
> = {
  mutationOptions: {
    // A failed response can still follow an accepted stop request.
    onSettled: (_data, _error, variables, _result, context) => {
      return context.client.invalidateQueries({
        queryKey: consoleQuery.rag.pipelines.byPipelineId.workflowRuns.key({
          input: { params: { pipeline_id: variables.params.pipeline_id } },
        }),
      })
    },
  },
}

export const rag_pipelines_byPipelineId_workflows_publish_post: PolicyAt<
  ['rag', 'pipelines', 'byPipelineId', 'workflows', 'publish', 'post']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) =>
      Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.rag.pipelines.byPipelineId.workflows.publish.get.key({
            input: { params: variables.params },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.rag.pipelines.byPipelineId.workflows.get.key({
            input: { params: variables.params },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: legacyWorkflowVersionHistoryKey,
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.datasets.get.key(),
        }),
      ]),
  },
}

export const rag_pipelines_byPipelineId_workflows_byWorkflowId_patch: PolicyAt<
  ['rag', 'pipelines', 'byPipelineId', 'workflows', 'byWorkflowId', 'patch']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) => {
      return Promise.all([
        context.client.invalidateQueries({
          queryKey: legacyWorkflowVersionHistoryKey,
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.rag.pipelines.byPipelineId.workflows.get.key({
            input: { params: { pipeline_id: variables.params.pipeline_id } },
          }),
        }),
      ])
    },
  },
}

export const rag_pipelines_byPipelineId_workflows_byWorkflowId_delete: PolicyAt<
  ['rag', 'pipelines', 'byPipelineId', 'workflows', 'byWorkflowId', 'delete']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) =>
      context.client.invalidateQueries({
        queryKey: consoleQuery.rag.pipelines.byPipelineId.workflows.get.key({
          input: { params: { pipeline_id: variables.params.pipeline_id } },
        }),
      }),
  },
}

export const rag_pipelines_byPipelineId_workflows_draft_processing_parameters_get: PolicyAt<
  ['rag', 'pipelines', 'byPipelineId', 'workflows', 'draft', 'processing', 'parameters', 'get']
> = { queryOptions: { staleTime: 0 } }

export const rag_pipelines_byPipelineId_workflows_draft_preProcessing_parameters_get: PolicyAt<
  ['rag', 'pipelines', 'byPipelineId', 'workflows', 'draft', 'preProcessing', 'parameters', 'get']
> = { queryOptions: { staleTime: 0 } }

export const rag_pipelines_byPipelineId_workflows_published_processing_parameters_get: PolicyAt<
  ['rag', 'pipelines', 'byPipelineId', 'workflows', 'published', 'processing', 'parameters', 'get']
> = { queryOptions: { staleTime: 0 } }

export const rag_pipelines_byPipelineId_workflows_published_preProcessing_parameters_get: PolicyAt<
  [
    'rag',
    'pipelines',
    'byPipelineId',
    'workflows',
    'published',
    'preProcessing',
    'parameters',
    'get',
  ]
> = { queryOptions: { staleTime: 0 } }

export const workspaces_current_toolProvider_builtin_byProvider_add_post: PolicyAt<
  ['workspaces', 'current', 'toolProvider', 'builtin', 'byProvider', 'add', 'post']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) =>
      Promise.all([
        context.client.invalidateQueries({
          queryKey:
            consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.info.get.key(
              { input: { params: { provider: variables.params.provider } } },
            ),
        }),
        context.client.invalidateQueries({
          queryKey:
            consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credentials.get.key({
              input: { params: { provider: variables.params.provider } },
            }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.tools.builtin.get.key(),
        }),
      ]),
  },
}

export const workspaces_current_toolProvider_builtin_byProvider_update_post: PolicyAt<
  ['workspaces', 'current', 'toolProvider', 'builtin', 'byProvider', 'update', 'post']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) =>
      Promise.all([
        context.client.invalidateQueries({
          queryKey:
            consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.info.get.key(
              { input: { params: { provider: variables.params.provider } } },
            ),
        }),
        context.client.invalidateQueries({
          queryKey:
            consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credentials.get.key({
              input: { params: { provider: variables.params.provider } },
            }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.tools.builtin.get.key(),
        }),
      ]),
  },
}

export const workspaces_current_toolProvider_builtin_byProvider_oauth_customClient_post: PolicyAt<
  [
    'workspaces',
    'current',
    'toolProvider',
    'builtin',
    'byProvider',
    'oauth',
    'customClient',
    'post',
  ]
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) =>
      Promise.all([
        context.client.invalidateQueries({
          queryKey:
            consoleQuery.workspaces.current.toolProvider.builtin.byProvider.oauth.clientSchema.get.key(
              { input: { params: { provider: variables.params.provider } } },
            ),
        }),
        context.client.invalidateQueries({
          queryKey:
            consoleQuery.workspaces.current.toolProvider.builtin.byProvider.oauth.customClient.get.key(
              { input: { params: { provider: variables.params.provider } } },
            ),
        }),
      ]),
  },
}

export const workspaces_current_toolProvider_builtin_byProvider_oauth_customClient_delete: PolicyAt<
  [
    'workspaces',
    'current',
    'toolProvider',
    'builtin',
    'byProvider',
    'oauth',
    'customClient',
    'delete',
  ]
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) =>
      Promise.all([
        context.client.invalidateQueries({
          queryKey:
            consoleQuery.workspaces.current.toolProvider.builtin.byProvider.oauth.clientSchema.get.key(
              { input: { params: { provider: variables.params.provider } } },
            ),
        }),
        context.client.invalidateQueries({
          queryKey:
            consoleQuery.workspaces.current.toolProvider.builtin.byProvider.oauth.customClient.get.key(
              { input: { params: { provider: variables.params.provider } } },
            ),
        }),
      ]),
  },
}

export const workspaces_current_toolProvider_builtin_byProvider_defaultCredential_post: PolicyAt<
  ['workspaces', 'current', 'toolProvider', 'builtin', 'byProvider', 'defaultCredential', 'post']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) =>
      Promise.all([
        context.client.invalidateQueries({
          queryKey:
            consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.info.get.key(
              { input: { params: { provider: variables.params.provider } } },
            ),
        }),
        context.client.invalidateQueries({
          queryKey:
            consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credentials.get.key({
              input: { params: { provider: variables.params.provider } },
            }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.tools.builtin.get.key(),
        }),
      ]),
  },
}

export const workspaces_current_toolProvider_builtin_byProvider_delete_post: PolicyAt<
  ['workspaces', 'current', 'toolProvider', 'builtin', 'byProvider', 'delete', 'post']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) =>
      Promise.all([
        context.client.invalidateQueries({
          queryKey:
            consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.info.get.key(
              { input: { params: { provider: variables.params.provider } } },
            ),
        }),
        context.client.invalidateQueries({
          queryKey:
            consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credentials.get.key({
              input: { params: { provider: variables.params.provider } },
            }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.tools.builtin.get.key(),
        }),
      ]),
  },
}

export const workspaces_current_networkAccessGroups_post: PolicyAt<
  ['workspaces', 'current', 'networkAccessGroups', 'post']
> = {
  mutationOptions: {
    onSettled: (_data, error, _variables, _result, context) => {
      if (error) return
      return invalidateNetworkAccessGroupQueries(consoleQuery, context.client)
    },
  },
}

export const workspaces_current_networkAccessGroups_byGroupId_put: PolicyAt<
  ['workspaces', 'current', 'networkAccessGroups', 'byGroupId', 'put']
> = {
  mutationOptions: {
    onSettled: (_data, error, _variables, _result, context) => {
      if (error) return
      return invalidateNetworkAccessGroupQueries(consoleQuery, context.client)
    },
  },
}

export const workspaces_current_networkAccessGroups_byGroupId_delete: PolicyAt<
  ['workspaces', 'current', 'networkAccessGroups', 'byGroupId', 'delete']
> = {
  mutationOptions: {
    onSettled: (_data, error, _variables, _result, context) => {
      if (error) return
      return invalidateNetworkAccessGroupQueries(consoleQuery, context.client)
    },
  },
}

export const workspaces_current_plugin_readme_get: PolicyAt<
  ['workspaces', 'current', 'plugin', 'readme', 'get']
> = {
  queryOptions: {
    context: { silent: true },
    retry: false,
  },
}

export const workspaces_current_plugin_asset_get: PolicyAt<
  ['workspaces', 'current', 'plugin', 'asset', 'get']
> = {
  queryOptions: { context: { silent: true } },
}

export const workspaces_current_endpoints_post: PolicyAt<
  ['workspaces', 'current', 'endpoints', 'post']
> = {
  mutationOptions: {
    onSettled: (_data, _error, _variables, _result, context) => {
      return Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.endpoints.list.key(),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.plugin.list.get.key(),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.plugin.byCategory.list.get.key(),
        }),
      ])
    },
  },
}

export const workspaces_current_endpoints_byId_patch: PolicyAt<
  ['workspaces', 'current', 'endpoints', 'byId', 'patch']
> = {
  mutationOptions: {
    onSettled: (_data, _error, _variables, _result, context) => {
      return Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.endpoints.list.key(),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.plugin.list.get.key(),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.plugin.byCategory.list.get.key(),
        }),
      ])
    },
  },
}

export const workspaces_current_endpoints_byId_delete: PolicyAt<
  ['workspaces', 'current', 'endpoints', 'byId', 'delete']
> = {
  mutationOptions: {
    onSettled: (_data, _error, _variables, _result, context) => {
      return Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.endpoints.list.key(),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.plugin.list.get.key(),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.plugin.byCategory.list.get.key(),
        }),
      ])
    },
  },
}

export const workspaces_current_endpoints_enable_post: PolicyAt<
  ['workspaces', 'current', 'endpoints', 'enable', 'post']
> = {
  mutationOptions: {
    onSettled: (_data, _error, _variables, _result, context) => {
      return Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.endpoints.list.key(),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.plugin.list.get.key(),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.plugin.byCategory.list.get.key(),
        }),
      ])
    },
  },
}

export const workspaces_current_endpoints_disable_post: PolicyAt<
  ['workspaces', 'current', 'endpoints', 'disable', 'post']
> = {
  mutationOptions: {
    onSettled: (_data, _error, _variables, _result, context) => {
      return Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.endpoints.list.key(),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.plugin.list.get.key(),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.plugin.byCategory.list.get.key(),
        }),
      ])
    },
  },
}

export const workspaces_current_skills_bySkillId_restore_post: PolicyAt<
  ['workspaces', 'current', 'skills', 'bySkillId', 'restore', 'post']
> = {
  mutationOptions: {
    onSettled: (_data, error, variables, _result, context) => {
      if (error) return
      void invalidateSkillVersionQueries(consoleQuery, context.client, variables.params.skill_id)
      void context.client.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.skills.get.key(),
      })
    },
  },
}

export const workspaces_current_skills_bySkillId_versions_byVersionId_delete: PolicyAt<
  ['workspaces', 'current', 'skills', 'bySkillId', 'versions', 'byVersionId', 'delete']
> = {
  mutationOptions: {
    onSettled: (_data, error, variables, _result, context) => {
      if (error) return
      void invalidateSkillVersionQueries(consoleQuery, context.client, variables.params.skill_id)
    },
  },
}

export const workspaces_current_skills_bySkillId_delete: PolicyAt<
  ['workspaces', 'current', 'skills', 'bySkillId', 'delete']
> = {
  mutationOptions: {
    onSettled: (_data, error, _variables, _result, context) => {
      if (error) return
      return context.client.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.agents.byAgentId.skills.get.key(),
      })
    },
  },
}

export const workspaces_current_rbac_roles_post: PolicyAt<
  ['workspaces', 'current', 'rbac', 'roles', 'post']
> = {
  mutationOptions: {
    onSettled: (_data, error, _variables, _result, context) =>
      error
        ? undefined
        : context.client.invalidateQueries({
            queryKey: consoleQuery.workspaces.current.rbac.roles.get.key(),
          }),
  },
}

export const workspaces_current_rbac_roles_byRoleId_put: PolicyAt<
  ['workspaces', 'current', 'rbac', 'roles', 'byRoleId', 'put']
> = {
  mutationOptions: {
    onSettled: (_data, error, _variables, _result, context) =>
      error
        ? undefined
        : context.client.invalidateQueries({
            queryKey: consoleQuery.workspaces.current.rbac.roles.get.key(),
          }),
  },
}

export const workspaces_current_rbac_roles_byRoleId_delete: PolicyAt<
  ['workspaces', 'current', 'rbac', 'roles', 'byRoleId', 'delete']
> = {
  mutationOptions: {
    onSettled: (_data, error, _variables, _result, context) =>
      error
        ? undefined
        : Promise.all([
            context.client.invalidateQueries({
              queryKey: consoleQuery.workspaces.current.rbac.roles.get.key(),
            }),
            context.client.invalidateQueries({
              queryKey: consoleQuery.workspaces.current.members.get.key(),
            }),
          ]),
  },
}

export const workspaces_current_rbac_roles_byRoleId_copy_post: PolicyAt<
  ['workspaces', 'current', 'rbac', 'roles', 'byRoleId', 'copy', 'post']
> = {
  mutationOptions: {
    onSettled: (_data, error, variables, _result, context) =>
      error
        ? undefined
        : Promise.all([
            context.client.invalidateQueries({
              queryKey: consoleQuery.workspaces.current.rbac.roles.get.key(),
            }),
            variables.body?.copy_member &&
              context.client.invalidateQueries({
                queryKey: consoleQuery.workspaces.current.members.get.key(),
              }),
          ]),
  },
}

export const workspaces_current_rbac_members_byMemberId_rbacRoles_put: PolicyAt<
  ['workspaces', 'current', 'rbac', 'members', 'byMemberId', 'rbacRoles', 'put']
> = {
  mutationOptions: {
    onSettled: (_data, error, variables, _result, context) =>
      error
        ? undefined
        : Promise.all([
            context.client.invalidateQueries({
              queryKey: consoleQuery.workspaces.current.rbac.members.byMemberId.rbacRoles.get.key({
                input: { params: variables.params },
              }),
            }),
            context.client.invalidateQueries({
              queryKey: consoleQuery.workspaces.current.members.get.key(),
            }),
          ]),
  },
}

export const workspaces_current_rbac_accessPolicies_post: PolicyAt<
  ['workspaces', 'current', 'rbac', 'accessPolicies', 'post']
> = {
  mutationOptions: {
    onSettled: (_data, error, _variables, _result, context) => {
      if (error) return
      return invalidateAccessPolicyQueries(consoleQuery, context.client)
    },
  },
}

export const workspaces_current_rbac_accessPolicies_byPolicyId_put: PolicyAt<
  ['workspaces', 'current', 'rbac', 'accessPolicies', 'byPolicyId', 'put']
> = {
  mutationOptions: {
    onSettled: (_data, error, _variables, _result, context) => {
      if (error) return
      return invalidateAccessPolicyQueries(consoleQuery, context.client)
    },
  },
}

export const workspaces_current_rbac_accessPolicies_byPolicyId_delete: PolicyAt<
  ['workspaces', 'current', 'rbac', 'accessPolicies', 'byPolicyId', 'delete']
> = {
  mutationOptions: {
    onSettled: (_data, error, _variables, _result, context) => {
      if (error) return
      return invalidateAccessPolicyQueries(consoleQuery, context.client)
    },
  },
}

export const workspaces_current_rbac_accessPolicies_byPolicyId_copy_post: PolicyAt<
  ['workspaces', 'current', 'rbac', 'accessPolicies', 'byPolicyId', 'copy', 'post']
> = {
  mutationOptions: {
    onSettled: (_data, error, _variables, _result, context) => {
      if (error) return
      return invalidateAccessPolicyQueries(consoleQuery, context.client)
    },
  },
}

export const workspaces_current_rbac_agents_byAgentId_whitelist_put: PolicyAt<
  ['workspaces', 'current', 'rbac', 'agents', 'byAgentId', 'whitelist', 'put']
> = {
  mutationOptions: {
    onSettled: (_data, error, variables, _result, context) => {
      if (error) return
      return invalidateAgentAccessQueries(consoleQuery, context.client, variables.params.agent_id)
    },
  },
}

export const workspaces_current_rbac_agents_byAgentId_users_byTargetAccountId_accessPolicies_put: PolicyAt<
  [
    'workspaces',
    'current',
    'rbac',
    'agents',
    'byAgentId',
    'users',
    'byTargetAccountId',
    'accessPolicies',
    'put',
  ]
> = {
  mutationOptions: {
    onSettled: (_data, error, variables, _result, context) => {
      if (error) return
      return invalidateAgentAccessQueries(consoleQuery, context.client, variables.params.agent_id)
    },
  },
}

export const workspaces_current_rbac_agents_byAgentId_accessPolicies_byPolicyId_memberBindings_delete: PolicyAt<
  [
    'workspaces',
    'current',
    'rbac',
    'agents',
    'byAgentId',
    'accessPolicies',
    'byPolicyId',
    'memberBindings',
    'delete',
  ]
> = {
  mutationOptions: {
    onSettled: (_data, error, variables, _result, context) => {
      if (error) return
      return invalidateAgentAccessQueries(consoleQuery, context.client, variables.params.agent_id)
    },
  },
}

export const account_education_get: PolicyAt<['account', 'education', 'get']> = {
  queryOptions: {
    // Passive probe: every callsite degrades to "not a student", so no toast.
    context: { silent: true },
    retry: false,
  },
}

export const account_education_post: PolicyAt<['account', 'education', 'post']> = {
  mutationOptions: {
    onSuccess: (data, _variables, _onMutateResult, context) => {
      if (data.message !== 'success') return

      void context.client.invalidateQueries({
        queryKey: consoleQuery.account.education.get.key(),
      })
    },
  },
}

export const account_profile_patch: PolicyAt<['account', 'profile', 'patch']> = {
  mutationOptions: {
    onSuccess: async (_data, _variables, _onMutateResult, context) => {
      await context.client.invalidateQueries({
        queryKey: consoleQuery.account.profile.get.key(),
      })
    },
  },
}

export const apps_post: PolicyAt<['apps', 'post']> = {
  mutationOptions: {
    onSuccess: (_data, _variables, _onMutateResult, context) => {
      void context.client.invalidateQueries({ queryKey: consoleQuery.features.get.key() })
      void context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.starred.get.key(),
      })
      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.recent.get.key(),
      })
    },
  },
}

export const apps_imports_post: PolicyAt<['apps', 'imports', 'post']> = {
  mutationOptions: {
    onSuccess: (data, variables, _onMutateResult, context) => {
      if (data.status !== 'completed' && data.status !== 'completed-with-warnings') return

      if (!('app_id' in variables.body) || !variables.body.app_id) {
        void context.client.invalidateQueries({
          queryKey: consoleQuery.features.get.key(),
        })
      }
      void context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.starred.get.key(),
      })
      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.recent.get.key(),
      })
    },
  },
}

export const apps_imports_byImportId_confirm_post: PolicyAt<
  ['apps', 'imports', 'byImportId', 'confirm', 'post']
> = {
  mutationOptions: {
    onSuccess: (data, _variables, _onMutateResult, context) => {
      if (data.status !== 'completed' && data.status !== 'completed-with-warnings') return

      void context.client.invalidateQueries({
        queryKey: consoleQuery.features.get.key(),
      })
      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.get.key(),
      })
      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.starred.get.key(),
      })
      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.recent.get.key(),
      })
    },
  },
}

export const apps_byAppId_traceRuns_bySourceKind_bySourceId_get: PolicyAt<
  ['apps', 'byAppId', 'traceRuns', 'bySourceKind', 'bySourceId', 'get']
> = { queryOptions: { context: { silent: true }, retry: false } }

export const apps_byAppId_workflowRuns_tasks_byTaskId_stop_post: PolicyAt<
  ['apps', 'byAppId', 'workflowRuns', 'tasks', 'byTaskId', 'stop', 'post']
> = {
  mutationOptions: {
    // A failed response can still follow an accepted stop request.
    onSettled: (_data, _error, variables, _result, context) => {
      return Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.workflowRuns.key({
            input: { params: { app_id: variables.params.app_id } },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.advancedChat.workflowRuns.key({
            input: { params: { app_id: variables.params.app_id } },
          }),
        }),
      ])
    },
  },
}

export const apps_byAppId_trace_post: PolicyAt<['apps', 'byAppId', 'trace', 'post']> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) => {
      context.client.setQueryData(
        consoleQuery.apps.byAppId.trace.get.queryKey({
          input: { params: variables.params },
        }),
        {
          ...variables.body,
          capture_content: variables.body.capture_content ?? false,
          capture_agent: variables.body.capture_agent ?? true,
        },
      )
    },
    onSettled: (_data, error, variables, _result, context) => {
      if (error && getHttpErrorStatus(error) !== 409) return
      return Promise.all([
        ...(error
          ? [
              context.client.invalidateQueries({
                queryKey: consoleQuery.apps.byAppId.traceConfig.get.key({
                  input: { params: variables.params },
                }),
              }),
            ]
          : []),
        context.client.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.trace.get.queryKey({
            input: { params: variables.params },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.traceCapabilities.get.key({
            input: { params: variables.params },
          }),
        }),
      ])
    },
  },
}

export const apps_byAppId_traceConfig_post: PolicyAt<['apps', 'byAppId', 'traceConfig', 'post']> = {
  mutationOptions: {
    onSettled: (_data, error, variables, _result, context) => {
      if (error && getHttpErrorStatus(error) !== 409) return
      return Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.trace.get.queryKey({
            input: { params: variables.params },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.traceConfig.get.queryKey({
            input: {
              params: variables.params,
              query: { tracing_provider: variables.body.tracing_provider },
            },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.traceCapabilities.get.key({
            input: { params: variables.params },
          }),
        }),
      ])
    },
  },
}

export const apps_byAppId_traceConfig_patch: PolicyAt<['apps', 'byAppId', 'traceConfig', 'patch']> =
  {
    mutationOptions: {
      onSettled: (_data, error, variables, _result, context) => {
        if (error && getHttpErrorStatus(error) !== 409) return
        return Promise.all([
          context.client.invalidateQueries({
            queryKey: consoleQuery.apps.byAppId.trace.get.queryKey({
              input: { params: variables.params },
            }),
          }),
          context.client.invalidateQueries({
            queryKey: consoleQuery.apps.byAppId.traceConfig.get.queryKey({
              input: {
                params: variables.params,
                query: { tracing_provider: variables.body.tracing_provider },
              },
            }),
          }),
          context.client.invalidateQueries({
            queryKey: consoleQuery.apps.byAppId.traceCapabilities.get.key({
              input: { params: variables.params },
            }),
          }),
        ])
      },
    },
  }

export const apps_byAppId_traceConfig_delete: PolicyAt<
  ['apps', 'byAppId', 'traceConfig', 'delete']
> = {
  mutationOptions: {
    onSettled: (_data, error, variables, _result, context) => {
      if (error && getHttpErrorStatus(error) !== 409) return
      return Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.trace.get.queryKey({
            input: { params: variables.params },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.traceConfig.get.queryKey({
            input: {
              params: variables.params,
              query: { tracing_provider: variables.query.tracing_provider },
            },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.traceCapabilities.get.key({
            input: { params: variables.params },
          }),
        }),
      ])
    },
  },
}

export const apps_byAppId_networkAccessGroup_put: PolicyAt<
  ['apps', 'byAppId', 'networkAccessGroup', 'put']
> = {
  mutationOptions: {
    onSettled: (_data, error, _variables, _result, context) => {
      if (error) return
      return invalidateNetworkAccessGroupQueries(consoleQuery, context.client)
    },
  },
}

export const apps_byAppId_apiEnable_post: PolicyAt<['apps', 'byAppId', 'apiEnable', 'post']> = {
  mutationOptions: {
    onSettled: (data, error, variables, _onMutateResult, context) => {
      if (error || !data) return

      context.client.setQueryData<AppDetailWithSite>(
        consoleQuery.apps.byAppId.get.queryKey({ input: { params: variables.params } }),
        (detail) =>
          detail
            ? { ...detail, enable_api: data.enable_api, updated_at: data.updated_at }
            : undefined,
      )

      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.byAppId.get.queryKey({
          input: { params: variables.params },
        }),
      })
    },
  },
}

export const apps_byAppId_delete: PolicyAt<['apps', 'byAppId', 'delete']> = {
  mutationOptions: {
    onSuccess: (_data, _variables, _onMutateResult, context) => {
      void context.client.invalidateQueries({ queryKey: consoleQuery.features.get.key() })
      return Promise.all([
        context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.apps.starred.get.key(),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.apps.recent.get.key(),
        }),
      ])
    },
  },
}

export const apps_byAppId_put: PolicyAt<['apps', 'byAppId', 'put']> = {
  mutationOptions: {
    onSuccess: (data, variables, _onMutateResult, context) => {
      context.client.setQueryData(
        consoleQuery.apps.byAppId.get.queryKey({
          input: { params: variables.params },
        }),
        data,
      )
      void context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.starred.get.key(),
      })
      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.recent.get.key(),
      })
    },
  },
}

export const apps_byAppId_siteEnable_post: PolicyAt<['apps', 'byAppId', 'siteEnable', 'post']> = {
  mutationOptions: {
    onSettled: (data, error, variables, _onMutateResult, context) => {
      if (error || !data) return

      context.client.setQueryData<AppDetailWithSite>(
        consoleQuery.apps.byAppId.get.queryKey({ input: { params: variables.params } }),
        (detail) =>
          detail
            ? { ...detail, enable_site: data.enable_site, updated_at: data.updated_at }
            : undefined,
      )

      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.byAppId.get.queryKey({
          input: { params: variables.params },
        }),
      })
    },
  },
}

export const apps_byAppId_site_post: PolicyAt<['apps', 'byAppId', 'site', 'post']> = {
  mutationOptions: {
    onSettled: (_data, error, variables, _onMutateResult, context) => {
      if (error) return
      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.byAppId.get.queryKey({
          input: { params: variables.params },
        }),
      })
      void context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.starred.get.key(),
      })
      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.recent.get.key(),
      })
    },
  },
}

export const apps_byAppId_site_accessTokenReset_post: PolicyAt<
  ['apps', 'byAppId', 'site', 'accessTokenReset', 'post']
> = {
  mutationOptions: {
    onSettled: (data, error, variables, _onMutateResult, context) => {
      if (error || !data) return

      const { code } = data
      if (code !== undefined) {
        context.client.setQueryData<AppDetailWithSite>(
          consoleQuery.apps.byAppId.get.queryKey({
            input: { params: variables.params },
          }),
          (detail) =>
            detail?.site
              ? {
                  ...detail,
                  site: { ...detail.site, code, access_token: code },
                }
              : detail,
        )
      }

      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.byAppId.get.queryKey({
          input: { params: variables.params },
        }),
      })
    },
  },
}

export const apps_byAppId_convertToWorkflow_post: PolicyAt<
  ['apps', 'byAppId', 'convertToWorkflow', 'post']
> = {
  mutationOptions: {
    onSuccess: (_data, _variables, _onMutateResult, context) => {
      void context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.starred.get.key(),
      })
      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.recent.get.key(),
      })
    },
  },
}

export const apps_byAppId_copy_post: PolicyAt<['apps', 'byAppId', 'copy', 'post']> = {
  mutationOptions: {
    onSuccess: (data, _variables, _onMutateResult, context) => {
      if (!('mode' in data)) return

      void context.client.invalidateQueries({
        queryKey: consoleQuery.features.get.key(),
      })
      void context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.starred.get.key(),
      })
      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.recent.get.key(),
      })
    },
  },
}

export const apps_byAppId_star_delete: PolicyAt<['apps', 'byAppId', 'star', 'delete']> = {
  mutationOptions: {
    onSuccess: (_data, _variables, _onMutateResult, context) =>
      Promise.all([
        context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.apps.starred.get.key(),
        }),
      ]),
  },
}

export const apps_byAppId_star_post: PolicyAt<['apps', 'byAppId', 'star', 'post']> = {
  mutationOptions: {
    onSuccess: (_data, _variables, _onMutateResult, context) =>
      Promise.all([
        context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.apps.starred.get.key(),
        }),
      ]),
  },
}

export const apps_byAppId_workflows_publish_post: PolicyAt<
  ['apps', 'byAppId', 'workflows', 'publish', 'post']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) =>
      Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.workflows.publish.get.key({
            input: { params: variables.params },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.workflows.get.key({
            input: { params: variables.params },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: legacyWorkflowVersionHistoryKey,
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.get.key({
            input: { params: variables.params },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.triggers.get.key({
            input: { params: variables.params },
          }),
        }),
      ]),
  },
}

export const apps_byAppId_workflows_byWorkflowId_patch: PolicyAt<
  ['apps', 'byAppId', 'workflows', 'byWorkflowId', 'patch']
> = {
  mutationOptions: {
    onSuccess: (data, variables, _result, context) => {
      syncAppWorkflowVersionCaches(context.client, consoleQuery, variables.params.app_id, data)
      const deploymentsKey = syncWorkflowDeploymentCaches(
        context.client,
        consoleQuery,
        variables.params.app_id,
        data,
      )
      return Promise.all([
        context.client.invalidateQueries({
          queryKey: legacyWorkflowVersionHistoryKey,
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.workflows.get.key({
            input: { params: { app_id: variables.params.app_id } },
          }),
        }),
        context.client.invalidateQueries({ queryKey: deploymentsKey }),
      ])
    },
  },
}

export const apps_byAppId_workflows_byWorkflowId_delete: PolicyAt<
  ['apps', 'byAppId', 'workflows', 'byWorkflowId', 'delete']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) =>
      context.client.invalidateQueries({
        queryKey: consoleQuery.apps.byAppId.workflows.get.key({
          input: { params: { app_id: variables.params.app_id } },
        }),
      }),
  },
}

export const apps_byAppId_workflows_draft_nodes_byNodeId_agentComposer_put: PolicyAt<
  ['apps', 'byAppId', 'workflows', 'draft', 'nodes', 'byNodeId', 'agentComposer', 'put']
> = {
  mutationOptions: {
    onSuccess: (composerState, variables, _onMutateResult, context) => {
      context.client.setQueryData(
        consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey({
          input: {
            params: variables.params,
          },
        }),
        composerState,
      )
    },
  },
}

export const apps_byAppId_workflows_draft_nodes_byNodeId_agentComposer_copyFromRoster_post: PolicyAt<
  [
    'apps',
    'byAppId',
    'workflows',
    'draft',
    'nodes',
    'byNodeId',
    'agentComposer',
    'copyFromRoster',
    'post',
  ]
> = {
  mutationOptions: {
    onSuccess: (composerState, variables, _onMutateResult, context) => {
      context.client.setQueryData(
        consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey({
          input: {
            params: variables.params,
          },
        }),
        composerState,
      )
    },
  },
}

export const apps_byAppId_workflows_draft_nodes_byNodeId_agentComposer_saveToRoster_post: PolicyAt<
  [
    'apps',
    'byAppId',
    'workflows',
    'draft',
    'nodes',
    'byNodeId',
    'agentComposer',
    'saveToRoster',
    'post',
  ]
> = {
  mutationOptions: {
    onSuccess: (composerState, variables, _onMutateResult, context) => {
      context.client.setQueryData(
        consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey({
          input: {
            params: variables.params,
          },
        }),
        composerState,
      )
      context.client.invalidateQueries({
        queryKey: consoleQuery.agent.get.key(),
      })
      context.client.invalidateQueries({
        queryKey: consoleQuery.agent.inviteOptions.get.key(),
      })

      const agentId =
        composerState.binding?.binding_type === 'roster_agent'
          ? composerState.binding.agent_id
          : undefined
      if (agentId) {
        context.client.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.get.queryKey({
            input: {
              params: {
                agent_id: agentId,
              },
            },
          }),
        })
      }
    },
  },
}

export const apps_byResourceId_apiKeys_post: PolicyAt<['apps', 'byResourceId', 'apiKeys', 'post']> =
  {
    mutationOptions: {
      onSuccess: (_data, variables, _onMutateResult, context) => {
        void context.client.invalidateQueries({
          queryKey: consoleQuery.apps.byResourceId.apiKeys.get.queryKey({
            input: { params: { resource_id: variables.params.resource_id } },
          }),
        })
      },
    },
  }

export const apps_byResourceId_apiKeys_byApiKeyId_delete: PolicyAt<
  ['apps', 'byResourceId', 'apiKeys', 'byApiKeyId', 'delete']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _onMutateResult, context) => {
      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.byResourceId.apiKeys.get.queryKey({
          input: { params: { resource_id: variables.params.resource_id } },
        }),
      })
    },
  },
}

export const datasets_processRule_get: PolicyAt<['datasets', 'processRule', 'get']> = {
  queryOptions: { refetchOnWindowFocus: false },
}

export const datasets_byDatasetId_get: PolicyAt<['datasets', 'byDatasetId', 'get']> = {
  queryOptions: {
    // A missing or inaccessible dataset sends the detail page back to the list.
    retry: (failureCount, error) => {
      const status = getHttpErrorStatus(error)
      if (status === 403 || status === 404) return false

      return failureCount < 3
    },
  },
}

export const datasets_byDatasetId_documents_byDocumentId_pipelineExecutionLog_get: PolicyAt<
  ['datasets', 'byDatasetId', 'documents', 'byDocumentId', 'pipelineExecutionLog', 'get']
> = { queryOptions: { staleTime: 0 } }

export const datasets_byDatasetId_documents_metadata_post: PolicyAt<
  ['datasets', 'byDatasetId', 'documents', 'metadata', 'post']
> = {
  mutationOptions: {
    onSettled: (_data, error, variables, _result, context) => {
      if (error) return
      const params = { dataset_id: variables.params.dataset_id }
      return Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.datasets.byDatasetId.metadata.get.queryKey({
            input: { params },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({
            input: { params },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.datasets.byDatasetId.documents.byDocumentId.get.key({
            input: { params },
          }),
        }),
      ])
    },
  },
}

export const datasets_byDatasetId_metadata_post: PolicyAt<
  ['datasets', 'byDatasetId', 'metadata', 'post']
> = {
  mutationOptions: {
    onSettled: (_data, error, variables, _result, context) => {
      if (error) return
      return context.client.invalidateQueries({
        queryKey: consoleQuery.datasets.byDatasetId.metadata.get.queryKey({
          input: { params: variables.params },
        }),
      })
    },
  },
}

export const datasets_byDatasetId_metadata_byMetadataId_patch: PolicyAt<
  ['datasets', 'byDatasetId', 'metadata', 'byMetadataId', 'patch']
> = {
  mutationOptions: {
    onSettled: (_data, error, variables, _result, context) => {
      if (error) return
      const params = { dataset_id: variables.params.dataset_id }
      return Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.datasets.byDatasetId.metadata.get.queryKey({
            input: { params },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({
            input: { params },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.datasets.byDatasetId.documents.byDocumentId.get.key({
            input: { params },
          }),
        }),
      ])
    },
  },
}

export const datasets_byDatasetId_metadata_byMetadataId_delete: PolicyAt<
  ['datasets', 'byDatasetId', 'metadata', 'byMetadataId', 'delete']
> = {
  mutationOptions: {
    onSettled: (_data, error, variables, _result, context) => {
      if (error) return
      const params = { dataset_id: variables.params.dataset_id }
      return Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.datasets.byDatasetId.metadata.get.queryKey({
            input: { params },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({
            input: { params },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.datasets.byDatasetId.documents.byDocumentId.get.key({
            input: { params },
          }),
        }),
      ])
    },
  },
}

export const datasets_byDatasetId_metadata_builtIn_byAction_post: PolicyAt<
  ['datasets', 'byDatasetId', 'metadata', 'builtIn', 'byAction', 'post']
> = {
  mutationOptions: {
    onSettled: (_data, error, variables, _result, context) => {
      if (error) return
      return context.client.invalidateQueries({
        queryKey: consoleQuery.datasets.byDatasetId.metadata.get.queryKey({
          input: { params: { dataset_id: variables.params.dataset_id } },
        }),
      })
    },
  },
}

export const datasets_apiKeys_post: PolicyAt<['datasets', 'apiKeys', 'post']> = {
  mutationOptions: {
    onSuccess: (_data, _variables, _onMutateResult, context) => {
      void context.client.invalidateQueries({
        queryKey: consoleQuery.datasets.apiKeys.get.key(),
      })
    },
  },
}

export const datasets_apiKeys_byApiKeyId_delete: PolicyAt<
  ['datasets', 'apiKeys', 'byApiKeyId', 'delete']
> = {
  mutationOptions: {
    onSuccess: (_data, _variables, _onMutateResult, context) => {
      void context.client.invalidateQueries({
        queryKey: consoleQuery.datasets.apiKeys.get.key(),
      })
    },
  },
}

export const snippets_bySnippetId_workflowRuns_tasks_byTaskId_stop_post: PolicyAt<
  ['snippets', 'bySnippetId', 'workflowRuns', 'tasks', 'byTaskId', 'stop', 'post']
> = {
  mutationOptions: {
    // A failed response can still follow an accepted stop request.
    onSettled: (_data, _error, variables, _result, context) => {
      return context.client.invalidateQueries({
        queryKey: consoleQuery.snippets.bySnippetId.workflowRuns.key({
          input: { params: { snippet_id: variables.params.snippet_id } },
        }),
      })
    },
  },
}

export const snippets_bySnippetId_workflows_byWorkflowId_patch: PolicyAt<
  ['snippets', 'bySnippetId', 'workflows', 'byWorkflowId', 'patch']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) => {
      return Promise.all([
        context.client.invalidateQueries({
          queryKey: legacyWorkflowVersionHistoryKey,
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.snippets.bySnippetId.workflows.get.key({
            input: { params: { snippet_id: variables.params.snippet_id } },
          }),
        }),
      ])
    },
  },
}

export const snippets_bySnippetId_workflows_byWorkflowId_delete: PolicyAt<
  ['snippets', 'bySnippetId', 'workflows', 'byWorkflowId', 'delete']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) =>
      context.client.invalidateQueries({
        queryKey: consoleQuery.snippets.bySnippetId.workflows.get.key({
          input: { params: { snippet_id: variables.params.snippet_id } },
        }),
      }),
  },
}

export const snippets_bySnippetId_workflows_draft_nodes_byNodeId_agentComposer_put: PolicyAt<
  ['snippets', 'bySnippetId', 'workflows', 'draft', 'nodes', 'byNodeId', 'agentComposer', 'put']
> = {
  mutationOptions: {
    onSuccess: (composerState, variables, _onMutateResult, context) => {
      context.client.setQueryData(
        consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey(
          {
            input: {
              params: variables.params,
            },
          },
        ),
        composerState,
      )
    },
  },
}

export const snippets_bySnippetId_workflows_draft_nodes_byNodeId_agentComposer_copyFromRoster_post: PolicyAt<
  [
    'snippets',
    'bySnippetId',
    'workflows',
    'draft',
    'nodes',
    'byNodeId',
    'agentComposer',
    'copyFromRoster',
    'post',
  ]
> = {
  mutationOptions: {
    onSuccess: (composerState, variables, _onMutateResult, context) => {
      context.client.setQueryData(
        consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey(
          {
            input: {
              params: variables.params,
            },
          },
        ),
        composerState,
      )
    },
  },
}

export const snippets_bySnippetId_workflows_draft_nodes_byNodeId_agentComposer_saveToRoster_post: PolicyAt<
  [
    'snippets',
    'bySnippetId',
    'workflows',
    'draft',
    'nodes',
    'byNodeId',
    'agentComposer',
    'saveToRoster',
    'post',
  ]
> = {
  mutationOptions: {
    onSuccess: (composerState, variables, _onMutateResult, context) => {
      context.client.setQueryData(
        consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey(
          {
            input: {
              params: variables.params,
            },
          },
        ),
        composerState,
      )
      context.client.invalidateQueries({
        queryKey: consoleQuery.agent.get.key(),
      })
      context.client.invalidateQueries({
        queryKey: consoleQuery.agent.inviteOptions.get.key(),
      })

      const agentId =
        composerState.binding?.binding_type === 'roster_agent'
          ? composerState.binding.agent_id
          : undefined
      if (agentId) {
        context.client.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.get.queryKey({
            input: {
              params: {
                agent_id: agentId,
              },
            },
          }),
        })
      }
    },
  },
}

export const installedApps_byInstalledAppId_get: PolicyAt<
  ['installedApps', 'byInstalledAppId', 'get']
> = {
  queryOptions: {
    retry: (failureCount, error) => {
      if (isNotFoundError(error)) return false

      return failureCount < 3
    },
  },
}

export const installedApps_byInstalledAppId_patch: PolicyAt<
  ['installedApps', 'byInstalledAppId', 'patch']
> = {
  mutationOptions: {
    onSuccess: (_response, variables, _onMutateResult, context) => {
      context.client.invalidateQueries({
        queryKey: consoleQuery.installedApps.get.key(),
      })
      context.client.invalidateQueries({
        queryKey: consoleQuery.installedApps.byInstalledAppId.get.queryKey({
          input: {
            params: variables.params,
          },
        }),
      })
    },
  },
}

export const agent_post: PolicyAt<['agent', 'post']> = {
  mutationOptions: {
    onSuccess: (_createdAgent, _variables, _onMutateResult, context) => {
      context.client.invalidateQueries({
        queryKey: consoleQuery.agent.get.key(),
      })
      context.client.invalidateQueries({
        queryKey: consoleQuery.agent.inviteOptions.get.key(),
      })
    },
  },
}

export const agent_byAgentId_trace_post: PolicyAt<['agent', 'byAgentId', 'trace', 'post']> = {
  mutationOptions: {
    onSuccess: (data, variables, _result, context) => {
      context.client.setQueryData(
        consoleQuery.agent.byAgentId.trace.get.queryKey({
          input: { params: variables.params },
        }),
        data,
      )
    },
    onSettled: (_data, error, variables, _result, context) => {
      if (error && getHttpErrorStatus(error) !== 409) return
      return Promise.all([
        ...(error
          ? [
              context.client.invalidateQueries({
                queryKey: consoleQuery.agent.byAgentId.traceConfig.get.key({
                  input: { params: variables.params },
                }),
              }),
            ]
          : []),
        context.client.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.trace.get.queryKey({
            input: { params: variables.params },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.traceCapabilities.get.key({
            input: { params: variables.params },
          }),
        }),
      ])
    },
  },
}

export const agent_byAgentId_traceConfig_post: PolicyAt<
  ['agent', 'byAgentId', 'traceConfig', 'post']
> = {
  mutationOptions: {
    onSettled: (_data, error, variables, _result, context) => {
      if (error && getHttpErrorStatus(error) !== 409) return
      return Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.trace.get.queryKey({
            input: { params: variables.params },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.traceConfig.get.queryKey({
            input: {
              params: variables.params,
              query: { tracing_provider: variables.body.tracing_provider },
            },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.traceCapabilities.get.key({
            input: { params: variables.params },
          }),
        }),
      ])
    },
  },
}

export const agent_byAgentId_traceConfig_patch: PolicyAt<
  ['agent', 'byAgentId', 'traceConfig', 'patch']
> = {
  mutationOptions: {
    onSettled: (_data, error, variables, _result, context) => {
      if (error && getHttpErrorStatus(error) !== 409) return
      return Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.trace.get.queryKey({
            input: { params: variables.params },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.traceConfig.get.queryKey({
            input: {
              params: variables.params,
              query: { tracing_provider: variables.body.tracing_provider },
            },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.traceCapabilities.get.key({
            input: { params: variables.params },
          }),
        }),
      ])
    },
  },
}

export const agent_byAgentId_traceConfig_delete: PolicyAt<
  ['agent', 'byAgentId', 'traceConfig', 'delete']
> = {
  mutationOptions: {
    onSettled: (_data, error, variables, _result, context) => {
      if (error && getHttpErrorStatus(error) !== 409) return
      return Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.trace.get.queryKey({
            input: { params: variables.params },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.traceConfig.get.queryKey({
            input: {
              params: variables.params,
              query: { tracing_provider: variables.query.tracing_provider },
            },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.traceCapabilities.get.key({
            input: { params: variables.params },
          }),
        }),
      ])
    },
  },
}

export const agent_byAgentId_apiKeys_post: PolicyAt<['agent', 'byAgentId', 'apiKeys', 'post']> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) =>
      void Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.apiKeys.get.queryKey({
            input: { params: { agent_id: variables.params.agent_id } },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.apiAccess.get.queryKey({
            input: { params: { agent_id: variables.params.agent_id } },
          }),
        }),
      ]),
  },
}

export const agent_byAgentId_apiKeys_byApiKeyId_delete: PolicyAt<
  ['agent', 'byAgentId', 'apiKeys', 'byApiKeyId', 'delete']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) =>
      void Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.apiKeys.get.queryKey({
            input: { params: { agent_id: variables.params.agent_id } },
          }),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.apiAccess.get.queryKey({
            input: { params: { agent_id: variables.params.agent_id } },
          }),
        }),
      ]),
  },
}

export const agent_byAgentId_get: PolicyAt<['agent', 'byAgentId', 'get']> = {
  queryOptions: {
    retry: (failureCount, error) => {
      if (isNotFoundError(error)) return false

      return failureCount < 3
    },
  },
}

export const agent_byAgentId_copy_post: PolicyAt<['agent', 'byAgentId', 'copy', 'post']> = {
  mutationOptions: {
    onSuccess: (copiedAgent, _variables, _onMutateResult, context) => {
      context.client.setQueryData(
        consoleQuery.agent.byAgentId.get.queryKey({
          input: {
            params: {
              agent_id: copiedAgent.id,
            },
          },
        }),
        copiedAgent,
      )
      context.client.invalidateQueries({
        queryKey: consoleQuery.agent.get.key(),
      })
      context.client.invalidateQueries({
        queryKey: consoleQuery.agent.inviteOptions.get.key(),
      })
    },
  },
}

export const agent_byAgentId_put: PolicyAt<['agent', 'byAgentId', 'put']> = {
  mutationOptions: {
    onSuccess: (updatedAgent, variables, _onMutateResult, context) => {
      context.client.setQueriesData(
        {
          queryKey: consoleQuery.agent.get.key({ type: 'query' }),
        },
        (oldList: AgentAppPagination | undefined) => {
          if (!oldList?.data.some((item) => item.id === updatedAgent.id)) return oldList

          return {
            ...oldList,
            data: oldList.data.map((item) => (item.id === updatedAgent.id ? updatedAgent : item)),
          }
        },
      )
      context.client.setQueriesData(
        {
          queryKey: consoleQuery.agent.get.key({ type: 'infinite' }),
        },
        (oldList: InfiniteData<AgentAppPagination, unknown> | undefined) => {
          if (!oldList?.pages.some((page) => page.data.some((item) => item.id === updatedAgent.id)))
            return oldList

          return {
            ...oldList,
            pages: oldList.pages.map((page) => ({
              ...page,
              data: page.data.map((item) => (item.id === updatedAgent.id ? updatedAgent : item)),
            })),
          }
        },
      )
      context.client.setQueryData(
        consoleQuery.agent.byAgentId.get.queryKey({
          input: {
            params: {
              agent_id: variables.params.agent_id,
            },
          },
        }),
        updatedAgent,
      )
      context.client.invalidateQueries({
        queryKey: consoleQuery.agent.inviteOptions.get.key(),
      })
    },
  },
}

export const agent_byAgentId_composer_put: PolicyAt<['agent', 'byAgentId', 'composer', 'put']> = {
  mutationOptions: {
    onSuccess: (composerState, variables, _onMutateResult, context) => {
      context.client.setQueryData(
        consoleQuery.agent.byAgentId.composer.get.queryKey({
          input: {
            params: {
              agent_id: variables.params.agent_id,
            },
          },
        }),
        composerState,
      )
      context.client.invalidateQueries({
        queryKey: consoleQuery.agent.get.key(),
      })
      if (variables.body.save_strategy !== 'save_as_new_version') return

      context.client.invalidateQueries({
        queryKey: consoleQuery.agent.inviteOptions.get.key(),
      })
      context.client.removeQueries({
        queryKey: consoleQuery.agent.inviteOptions.get.key(),
      })
    },
  },
}

export const agent_byAgentId_publish_post: PolicyAt<['agent', 'byAgentId', 'publish', 'post']> = {
  mutationOptions: {
    onSuccess: (publishResult, variables, _onMutateResult, context) => {
      context.client.setQueryData<AgentAppComposerResponse>(
        consoleQuery.agent.byAgentId.composer.get.queryKey({
          input: {
            params: {
              agent_id: variables.params.agent_id,
            },
          },
        }),
        (composerState) => {
          if (!composerState) return composerState

          return {
            ...composerState,
            active_config_is_published: true,
            active_config_snapshot: publishResult.active_config_snapshot,
            agent: {
              ...composerState.agent,
              active_config_snapshot_id: publishResult.active_config_snapshot_id,
            },
            draft: publishResult.draft === undefined ? composerState.draft : publishResult.draft,
          }
        },
      )
      context.client.invalidateQueries({
        queryKey: consoleQuery.agent.get.key(),
      })
      context.client.invalidateQueries({
        queryKey: consoleQuery.agent.inviteOptions.get.key(),
      })
      context.client.removeQueries({
        queryKey: consoleQuery.agent.inviteOptions.get.key(),
      })
    },
  },
}

export const agent_byAgentId_delete: PolicyAt<['agent', 'byAgentId', 'delete']> = {
  mutationOptions: {
    onSuccess: (_data, variables, _onMutateResult, context) => {
      context.client.removeQueries({
        queryKey: consoleQuery.agent.byAgentId.key({
          input: {
            params: {
              agent_id: variables.params.agent_id,
            },
          },
        }),
      })
      context.client.setQueriesData(
        {
          queryKey: consoleQuery.agent.get.key({ type: 'query' }),
        },
        (oldList: AgentAppPagination | undefined) => {
          if (!oldList?.data.some((item) => item.id === variables.params.agent_id)) return oldList

          return {
            ...oldList,
            data: oldList.data.filter((item) => item.id !== variables.params.agent_id),
            total: Math.max(0, oldList.total - 1),
          }
        },
      )
      context.client.setQueriesData(
        {
          queryKey: consoleQuery.agent.get.key({ type: 'infinite' }),
        },
        (oldList: InfiniteData<AgentAppPagination, unknown> | undefined) => {
          if (
            !oldList?.pages.some((page) =>
              page.data.some((item) => item.id === variables.params.agent_id),
            )
          )
            return oldList

          return {
            ...oldList,
            pages: oldList.pages.map((page) => {
              const total = Math.max(0, page.total - 1)

              return {
                ...page,
                data: page.data.filter((item) => item.id !== variables.params.agent_id),
                has_more: page.page * page.limit < total,
                total,
              }
            }),
          }
        },
      )
      context.client.invalidateQueries({
        queryKey: consoleQuery.agent.get.key(),
      })
      context.client.invalidateQueries({
        queryKey: consoleQuery.agent.inviteOptions.get.key(),
      })
    },
  },
}

export const apiBasedExtension_post: PolicyAt<['apiBasedExtension', 'post']> = {
  mutationOptions: {
    onSuccess: (createdExtension, _variables, _onMutateResult, context) => {
      context.client.setQueryData(
        consoleQuery.apiBasedExtension.get.queryKey(),
        (oldExtensions: ApiBasedExtensionResponse[] | undefined) =>
          oldExtensions ? [createdExtension, ...oldExtensions] : oldExtensions,
      )
    },
  },
}

export const apiBasedExtension_byId_post: PolicyAt<['apiBasedExtension', 'byId', 'post']> = {
  mutationOptions: {
    onSuccess: (updatedExtension, variables, _onMutateResult, context) => {
      context.client.setQueryData(
        consoleQuery.apiBasedExtension.get.queryKey(),
        (oldExtensions: ApiBasedExtensionResponse[] | undefined) =>
          oldExtensions?.map((extension) =>
            extension.id === variables.params.id ? updatedExtension : extension,
          ),
      )
    },
  },
}

export const apiBasedExtension_byId_delete: PolicyAt<['apiBasedExtension', 'byId', 'delete']> = {
  mutationOptions: {
    onSuccess: (_data, variables, _onMutateResult, context) => {
      context.client.setQueryData(
        consoleQuery.apiBasedExtension.get.queryKey(),
        (oldExtensions: ApiBasedExtensionResponse[] | undefined) =>
          oldExtensions?.filter((extension) => extension.id !== variables.params.id),
      )
    },
  },
}

export const resourceAccessTokens_post: PolicyAt<['resourceAccessTokens', 'post']> = {
  mutationOptions: {
    onSettled: (_data, error, _variables, _result, context) => {
      if (error) return
      void context.client.invalidateQueries({
        queryKey: consoleQuery.resourceAccessTokens.get.key(),
      })
    },
  },
}

export const resourceAccessTokens_byTokenId_patch: PolicyAt<
  ['resourceAccessTokens', 'byTokenId', 'patch']
> = {
  mutationOptions: {
    onSettled: (_data, error, _variables, _result, context) => {
      if (error) return
      void context.client.invalidateQueries({
        queryKey: consoleQuery.resourceAccessTokens.get.key(),
      })
    },
  },
}

export const resourceAccessTokens_byTokenId_relations_byRelationId_delete: PolicyAt<
  ['resourceAccessTokens', 'byTokenId', 'relations', 'byRelationId', 'delete']
> = {
  mutationOptions: {
    onSettled: (_data, error, _variables, _result, context) => {
      if (error) return
      void context.client.invalidateQueries({
        queryKey: consoleQuery.resourceAccessTokens.get.key(),
      })
    },
  },
}

export const tags_post: PolicyAt<['tags', 'post']> = {
  mutationOptions: {
    onSuccess: (tag, variables, _onMutateResult, context) => {
      context.client.setQueryData(
        consoleQuery.tags.get.queryKey({
          input: {
            query: {
              type: variables.body.type,
            },
          },
        }),
        (oldTags: Tag[] | undefined) => (oldTags ? [tag, ...oldTags] : oldTags),
      )
    },
  },
}

export const tags_byTagId_patch: PolicyAt<['tags', 'byTagId', 'patch']> = {
  mutationOptions: {
    onSuccess: (updatedTag, variables, _onMutateResult, context) => {
      context.client.setQueriesData(
        {
          queryKey: consoleQuery.tags.get.key({ type: 'query' }),
        },
        (oldTags: Tag[] | undefined) =>
          oldTags?.map((tag) => (tag.id === variables.params.tag_id ? updatedTag : tag)),
      )

      if (updatedTag.type !== 'app') return

      void context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.starred.get.key(),
      })
      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.recent.get.key(),
      })
    },
  },
}

export const tags_byTagId_delete: PolicyAt<['tags', 'byTagId', 'delete']> = {
  mutationOptions: {
    onSuccess: (_data, variables, _onMutateResult, context) => {
      const deletedTag = context.client
        .getQueriesData<Tag[]>({
          queryKey: consoleQuery.tags.get.key({ type: 'query' }),
        })
        .flatMap(([, tags]) => tags ?? [])
        .find((tag) => tag.id === variables.params.tag_id)

      context.client.setQueriesData(
        {
          queryKey: consoleQuery.tags.get.key({ type: 'query' }),
        },
        (oldTags: Tag[] | undefined) =>
          oldTags?.filter((tag) => tag.id !== variables.params.tag_id),
      )

      if (deletedTag?.type !== 'app') return

      void context.client.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.starred.get.key(),
      })
      void context.client.invalidateQueries({
        queryKey: consoleQuery.apps.recent.get.key(),
      })
    },
  },
}

export const enterprise_appDeploy_accessService_updateEnvironmentApi: PolicyAt<
  ['enterprise', 'appDeploy', 'accessService', 'updateEnvironmentApi']
> = {
  mutationOptions: {
    onSuccess: (updated, variables, _result, context) => {
      const { app_id, environment_id } = variables.params
      context.client.setQueryData(
        consoleQuery.enterprise.appDeploy.accessService.getEnvironmentApi.queryKey({
          input: { params: { app_id, environment_id } },
        }),
        updated,
      )
      const list =
        consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryKey({
          input: { params: { app_id } },
        })
      const detail =
        consoleQuery.enterprise.appDeploy.deploymentService.getEnvironmentDeployment.queryKey({
          input: { params: { app_id, environment_id } },
        })
      context.client.setQueryData(
        list,
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
        detail,
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
        context.client.invalidateQueries({ queryKey: list }),
        context.client.invalidateQueries({ queryKey: detail }),
      ])
    },
  },
}

export const enterprise_appDeploy_accessService_updateEnvironmentSite: PolicyAt<
  ['enterprise', 'appDeploy', 'accessService', 'updateEnvironmentSite']
> = {
  mutationOptions: {
    onSuccess: (updated, variables, _result, context) => {
      const { app_id, environment_id } = variables.params
      context.client.setQueryData(
        consoleQuery.enterprise.appDeploy.accessService.getEnvironmentSite.queryKey({
          input: { params: { app_id, environment_id } },
        }),
        updated,
      )
      const list =
        consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryKey({
          input: { params: { app_id } },
        })
      const detail =
        consoleQuery.enterprise.appDeploy.deploymentService.getEnvironmentDeployment.queryKey({
          input: { params: { app_id, environment_id } },
        })
      context.client.setQueryData(
        list,
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
        detail,
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
        context.client.invalidateQueries({ queryKey: list }),
        context.client.invalidateQueries({ queryKey: detail }),
      ])
    },
  },
}

export const enterprise_appDeploy_accessService_createEnvironmentApiKey: PolicyAt<
  ['enterprise', 'appDeploy', 'accessService', 'createEnvironmentApiKey']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) => {
      const { app_id, environment_id } = variables.params
      return Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.enterprise.appDeploy.accessService.listEnvironmentApiKeys.queryKey(
            {
              input: { params: { app_id, environment_id } },
            },
          ),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.enterprise.appDeploy.accessService.getEnvironmentApi.queryKey({
            input: { params: { app_id, environment_id } },
          }),
        }),
      ])
    },
  },
}

export const enterprise_appDeploy_accessService_deleteEnvironmentApiKey: PolicyAt<
  ['enterprise', 'appDeploy', 'accessService', 'deleteEnvironmentApiKey']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) => {
      const { app_id, environment_id } = variables.params
      return Promise.all([
        context.client.invalidateQueries({
          queryKey: consoleQuery.enterprise.appDeploy.accessService.listEnvironmentApiKeys.queryKey(
            {
              input: { params: { app_id, environment_id } },
            },
          ),
        }),
        context.client.invalidateQueries({
          queryKey: consoleQuery.enterprise.appDeploy.accessService.getEnvironmentApi.queryKey({
            input: { params: { app_id, environment_id } },
          }),
        }),
      ])
    },
  },
}

export const enterprise_appDeploy_deploymentService_deployWorkflow: PolicyAt<
  ['enterprise', 'appDeploy', 'deploymentService', 'deployWorkflow']
> = {
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
            consoleQuery.enterprise.appDeploy.deploymentService.getEnvironmentDeployment.queryKey({
              input: { params: { app_id, environment_id } },
            }),
        }),
      ])
    },
  },
}

export const enterprise_appDeploy_deploymentService_undeployWorkflow: PolicyAt<
  ['enterprise', 'appDeploy', 'deploymentService', 'undeployWorkflow']
> = {
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
            consoleQuery.enterprise.appDeploy.deploymentService.getEnvironmentDeployment.queryKey({
              input: { params: { app_id, environment_id } },
            }),
        }),
        context.client.invalidateQueries({
          queryKey:
            consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryKey({
              input: { params: { app_id } },
            }),
        }),
      ])
    },
  },
}

export const enterprise_webAppAuth_updateWebAppWhitelistSubjects: PolicyAt<
  ['enterprise', 'webAppAuth', 'updateWebAppWhitelistSubjects']
> = {
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
}

function invalidateQueryKeys(client: QueryClient, queryKeys: QueryKey[]) {
  return Promise.all(queryKeys.map((queryKey) => client.invalidateQueries({ queryKey })))
}

function invalidateNetworkAccessGroupQueries(query: ConsoleQueryKeys, client: QueryClient) {
  return invalidateQueryKeys(client, [
    query.workspaces.current.networkAccessGroups.get.key(),
    query.workspaces.current.networkAccessGroups.byGroupId.key(),
    query.apps.byAppId.networkAccessGroup.key(),
  ])
}

function invalidateAccessPolicyQueries(query: ConsoleQueryKeys, client: QueryClient) {
  return invalidateQueryKeys(client, [
    query.workspaces.current.rbac.key(),
    query.agent.get.key(),
    query.agent.byAgentId.get.key(),
    query.apps.byAppId.get.key(),
    query.datasets.byDatasetId.get.key(),
  ])
}

function invalidateAgentAccessQueries(
  query: ConsoleQueryKeys,
  client: QueryClient,
  agentId: string,
) {
  return invalidateQueryKeys(client, [
    query.workspaces.current.rbac.agents.byAgentId.key({
      input: { params: { agent_id: agentId } },
    }),
    query.workspaces.current.rbac.myPermissions.get.key(),
    query.agent.get.key(),
    query.agent.inviteOptions.get.key(),
    query.agent.byAgentId.get.queryKey({ input: { params: { agent_id: agentId } } }),
  ])
}

function invalidateSkillVersionQueries(
  query: ConsoleQueryKeys,
  client: QueryClient,
  skillId: string,
) {
  const input = { params: { skill_id: skillId } }
  return invalidateQueryKeys(client, [
    query.workspaces.current.skills.bySkillId.get.key({ input }),
    query.workspaces.current.skills.bySkillId.versions.get.key({ input }),
    query.workspaces.current.agents.byAgentId.skills.get.key(),
  ])
}

export const workspaces_current_members_byMemberId_delete: PolicyAt<
  ['workspaces', 'current', 'members', 'byMemberId', 'delete']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) => {
      context.client.setQueriesData(
        { queryKey: consoleQuery.workspaces.current.members.get.key() },
        (members: AccountWithRoleListResponse | undefined) =>
          members && {
            ...members,
            accounts: members.accounts.filter((member) => member.id !== variables.params.member_id),
          },
      )
      void context.client.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.members.get.key(),
      })
    },
  },
}

export const knowledgeFs_spaces_byControlSpaceId_delete: PolicyAt<
  ['knowledgeFs', 'spaces', 'byControlSpaceId', 'delete']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) => {
      context.client.setQueriesData(
        { queryKey: consoleQuery.knowledgeFs.spaces.get.key({ type: 'query' }) },
        (list: KnowledgeFsSpaceListResponse | undefined) => {
          if (
            !list?.data.some((item) => item.control_space_id === variables.params.control_space_id)
          )
            return list
          return {
            ...list,
            data: list.data.filter(
              (item) => item.control_space_id !== variables.params.control_space_id,
            ),
          }
        },
      )
      context.client.setQueriesData(
        { queryKey: consoleQuery.knowledgeFs.spaces.get.key({ type: 'infinite' }) },
        (list: InfiniteData<KnowledgeFsSpaceListResponse, unknown> | undefined) => {
          if (
            !list?.pages.some((page) =>
              page.data.some((item) => item.control_space_id === variables.params.control_space_id),
            )
          )
            return list
          return {
            ...list,
            pages: list.pages.map((page) => ({
              ...page,
              data: page.data.filter(
                (item) => item.control_space_id !== variables.params.control_space_id,
              ),
            })),
          }
        },
      )
      void context.client.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.get.key(),
      })
    },
  },
}

export const datasets_byDatasetId_delete: PolicyAt<['datasets', 'byDatasetId', 'delete']> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) => {
      context.client.setQueriesData(
        { queryKey: consoleQuery.datasets.get.key({ type: 'query' }) },
        (list: DatasetListResponse | undefined) => {
          if (!list?.data.some((item) => item.id === variables.params.dataset_id)) return list
          const total = Math.max(0, list.total - 1)
          return {
            ...list,
            data: list.data.filter((item) => item.id !== variables.params.dataset_id),
            total,
            has_more: list.page * list.limit < total,
          }
        },
      )
      context.client.setQueriesData(
        { queryKey: consoleQuery.datasets.get.key({ type: 'infinite' }) },
        (list: InfiniteData<DatasetListResponse, unknown> | undefined) => {
          if (
            !list?.pages.some((page) =>
              page.data.some((item) => item.id === variables.params.dataset_id),
            )
          )
            return list
          return {
            ...list,
            pages: list.pages.map((page) => {
              const total = Math.max(0, page.total - 1)
              return {
                ...page,
                data: page.data.filter((item) => item.id !== variables.params.dataset_id),
                total,
                has_more: page.page * page.limit < total,
              }
            }),
          }
        },
      )
      void context.client.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
    },
  },
}

export const datasets_byDatasetId_documents_delete: PolicyAt<
  ['datasets', 'byDatasetId', 'documents', 'delete']
> = {
  mutationOptions: {
    onSuccess: (_data, variables, _result, context) => {
      const documentIds = new Set(variables.query?.document_id ?? [])
      const input = { params: variables.params }
      context.client.setQueriesData(
        {
          queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({
            type: 'query',
            input,
          }),
        },
        (list: DocumentWithSegmentsListResponse | undefined) => {
          if (!list) return list
          const data = list.data.filter((document) => !documentIds.has(document.id))
          if (data.length === list.data.length) return list
          const total = Math.max(0, list.total - (list.data.length - data.length))
          return { ...list, data, total, has_more: list.page * list.limit < total }
        },
      )
      void context.client.invalidateQueries({
        queryKey: consoleQuery.datasets.byDatasetId.documents.get.key({ input }),
      })
    },
  },
}
