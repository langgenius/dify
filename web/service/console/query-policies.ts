import type { ConsoleClient } from './index'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import * as defaults from './query-defaults'

export function createConsoleQuery(consoleClient: ConsoleClient) {
  return createTanstackQueryUtils(consoleClient, {
    path: ['console'],
    experimental_defaults: {
      workflowRunArchives: {
        downloads: { post: defaults.workflowRunArchives_downloads_post },
        byYear: { byMonth: { delete: defaults.workflowRunArchives_byYear_byMonth_delete } },
      },
      auth: {
        plugin: {
          datasource: {
            list: { get: defaults.auth_plugin_datasource_list_get },
            defaultList: { get: defaults.auth_plugin_datasource_defaultList_get },
            byProviderId: {
              post: defaults.auth_plugin_datasource_byProviderId_post,
              update: { post: defaults.auth_plugin_datasource_byProviderId_update_post },
              customClient: {
                post: defaults.auth_plugin_datasource_byProviderId_customClient_post,
                delete: defaults.auth_plugin_datasource_byProviderId_customClient_delete,
              },
              get: defaults.auth_plugin_datasource_byProviderId_get,
              default: { post: defaults.auth_plugin_datasource_byProviderId_default_post },
              delete: { post: defaults.auth_plugin_datasource_byProviderId_delete_post },
            },
          },
        },
      },
      notion: {
        pages: {
          byPageId: {
            byPageType: { preview: { get: defaults.notion_pages_byPageId_byPageType_preview_get } },
          },
        },
      },
      rag: {
        pipeline: {
          templates: { byTemplateId: { get: defaults.rag_pipeline_templates_byTemplateId_get } },
        },
        pipelines: {
          datasourcePlugins: { get: defaults.rag_pipelines_datasourcePlugins_get },
          imports: {
            post: defaults.rag_pipelines_imports_post,
            byImportId: {
              confirm: { post: defaults.rag_pipelines_imports_byImportId_confirm_post },
            },
          },
          byPipelineId: {
            workflowRuns: {
              tasks: {
                byTaskId: {
                  stop: {
                    post: defaults.rag_pipelines_byPipelineId_workflowRuns_tasks_byTaskId_stop_post,
                  },
                },
              },
            },
            workflows: {
              publish: { post: defaults.rag_pipelines_byPipelineId_workflows_publish_post },
              byWorkflowId: {
                patch: defaults.rag_pipelines_byPipelineId_workflows_byWorkflowId_patch,
                delete: defaults.rag_pipelines_byPipelineId_workflows_byWorkflowId_delete,
              },
              draft: {
                processing: {
                  parameters: {
                    get: defaults.rag_pipelines_byPipelineId_workflows_draft_processing_parameters_get,
                  },
                },
                preProcessing: {
                  parameters: {
                    get: defaults.rag_pipelines_byPipelineId_workflows_draft_preProcessing_parameters_get,
                  },
                },
              },
              published: {
                processing: {
                  parameters: {
                    get: defaults.rag_pipelines_byPipelineId_workflows_published_processing_parameters_get,
                  },
                },
                preProcessing: {
                  parameters: {
                    get: defaults.rag_pipelines_byPipelineId_workflows_published_preProcessing_parameters_get,
                  },
                },
              },
            },
          },
        },
      },
      workspaces: {
        current: {
          toolProvider: {
            builtin: {
              byProvider: {
                add: { post: defaults.workspaces_current_toolProvider_builtin_byProvider_add_post },
                update: {
                  post: defaults.workspaces_current_toolProvider_builtin_byProvider_update_post,
                },
                oauth: {
                  customClient: {
                    post: defaults.workspaces_current_toolProvider_builtin_byProvider_oauth_customClient_post,
                    delete:
                      defaults.workspaces_current_toolProvider_builtin_byProvider_oauth_customClient_delete,
                  },
                },
                defaultCredential: {
                  post: defaults.workspaces_current_toolProvider_builtin_byProvider_defaultCredential_post,
                },
                delete: {
                  post: defaults.workspaces_current_toolProvider_builtin_byProvider_delete_post,
                },
              },
            },
          },
          networkAccessGroups: {
            post: defaults.workspaces_current_networkAccessGroups_post,
            byGroupId: {
              put: defaults.workspaces_current_networkAccessGroups_byGroupId_put,
              delete: defaults.workspaces_current_networkAccessGroups_byGroupId_delete,
            },
          },
          plugin: {
            readme: { get: defaults.workspaces_current_plugin_readme_get },
            asset: { get: defaults.workspaces_current_plugin_asset_get },
          },
          endpoints: {
            post: defaults.workspaces_current_endpoints_post,
            byId: {
              patch: defaults.workspaces_current_endpoints_byId_patch,
              delete: defaults.workspaces_current_endpoints_byId_delete,
            },
            enable: { post: defaults.workspaces_current_endpoints_enable_post },
            disable: { post: defaults.workspaces_current_endpoints_disable_post },
          },
          skills: {
            bySkillId: {
              restore: { post: defaults.workspaces_current_skills_bySkillId_restore_post },
              versions: {
                byVersionId: {
                  delete: defaults.workspaces_current_skills_bySkillId_versions_byVersionId_delete,
                },
              },
              delete: defaults.workspaces_current_skills_bySkillId_delete,
            },
          },
          rbac: {
            roles: {
              post: defaults.workspaces_current_rbac_roles_post,
              byRoleId: {
                put: defaults.workspaces_current_rbac_roles_byRoleId_put,
                delete: defaults.workspaces_current_rbac_roles_byRoleId_delete,
                copy: { post: defaults.workspaces_current_rbac_roles_byRoleId_copy_post },
              },
            },
            members: {
              byMemberId: {
                rbacRoles: {
                  put: defaults.workspaces_current_rbac_members_byMemberId_rbacRoles_put,
                },
              },
            },
            accessPolicies: {
              post: defaults.workspaces_current_rbac_accessPolicies_post,
              byPolicyId: {
                put: defaults.workspaces_current_rbac_accessPolicies_byPolicyId_put,
                delete: defaults.workspaces_current_rbac_accessPolicies_byPolicyId_delete,
                copy: {
                  post: defaults.workspaces_current_rbac_accessPolicies_byPolicyId_copy_post,
                },
              },
            },
            agents: {
              byAgentId: {
                whitelist: { put: defaults.workspaces_current_rbac_agents_byAgentId_whitelist_put },
                users: {
                  byTargetAccountId: {
                    accessPolicies: {
                      put: defaults.workspaces_current_rbac_agents_byAgentId_users_byTargetAccountId_accessPolicies_put,
                    },
                  },
                },
                accessPolicies: {
                  byPolicyId: {
                    memberBindings: {
                      delete:
                        defaults.workspaces_current_rbac_agents_byAgentId_accessPolicies_byPolicyId_memberBindings_delete,
                    },
                  },
                },
              },
            },
          },
        },
      },
      account: {
        education: { get: defaults.account_education_get, post: defaults.account_education_post },
        profile: { patch: defaults.account_profile_patch },
      },
      apps: {
        post: defaults.apps_post,
        imports: {
          post: defaults.apps_imports_post,
          byImportId: { confirm: { post: defaults.apps_imports_byImportId_confirm_post } },
        },
        byAppId: {
          traceRuns: {
            bySourceKind: {
              bySourceId: { get: defaults.apps_byAppId_traceRuns_bySourceKind_bySourceId_get },
            },
          },
          workflowRuns: {
            tasks: {
              byTaskId: {
                stop: { post: defaults.apps_byAppId_workflowRuns_tasks_byTaskId_stop_post },
              },
            },
          },
          trace: { post: defaults.apps_byAppId_trace_post },
          traceConfig: {
            post: defaults.apps_byAppId_traceConfig_post,
            patch: defaults.apps_byAppId_traceConfig_patch,
            delete: defaults.apps_byAppId_traceConfig_delete,
          },
          networkAccessGroup: { put: defaults.apps_byAppId_networkAccessGroup_put },
          apiEnable: { post: defaults.apps_byAppId_apiEnable_post },
          delete: defaults.apps_byAppId_delete,
          put: defaults.apps_byAppId_put,
          siteEnable: { post: defaults.apps_byAppId_siteEnable_post },
          site: {
            post: defaults.apps_byAppId_site_post,
            accessTokenReset: { post: defaults.apps_byAppId_site_accessTokenReset_post },
          },
          convertToWorkflow: { post: defaults.apps_byAppId_convertToWorkflow_post },
          copy: { post: defaults.apps_byAppId_copy_post },
          star: {
            delete: defaults.apps_byAppId_star_delete,
            post: defaults.apps_byAppId_star_post,
          },
          workflows: {
            publish: { post: defaults.apps_byAppId_workflows_publish_post },
            byWorkflowId: {
              patch: defaults.apps_byAppId_workflows_byWorkflowId_patch,
              delete: defaults.apps_byAppId_workflows_byWorkflowId_delete,
            },
            draft: {
              nodes: {
                byNodeId: {
                  agentComposer: {
                    put: defaults.apps_byAppId_workflows_draft_nodes_byNodeId_agentComposer_put,
                    copyFromRoster: {
                      post: defaults.apps_byAppId_workflows_draft_nodes_byNodeId_agentComposer_copyFromRoster_post,
                    },
                    saveToRoster: {
                      post: defaults.apps_byAppId_workflows_draft_nodes_byNodeId_agentComposer_saveToRoster_post,
                    },
                  },
                },
              },
            },
          },
        },
        byResourceId: {
          apiKeys: {
            post: defaults.apps_byResourceId_apiKeys_post,
            byApiKeyId: { delete: defaults.apps_byResourceId_apiKeys_byApiKeyId_delete },
          },
        },
      },
      datasets: {
        processRule: { get: defaults.datasets_processRule_get },
        byDatasetId: {
          get: defaults.datasets_byDatasetId_get,
          documents: {
            byDocumentId: {
              pipelineExecutionLog: {
                get: defaults.datasets_byDatasetId_documents_byDocumentId_pipelineExecutionLog_get,
              },
            },
            metadata: { post: defaults.datasets_byDatasetId_documents_metadata_post },
          },
          metadata: {
            post: defaults.datasets_byDatasetId_metadata_post,
            byMetadataId: {
              patch: defaults.datasets_byDatasetId_metadata_byMetadataId_patch,
              delete: defaults.datasets_byDatasetId_metadata_byMetadataId_delete,
            },
            builtIn: {
              byAction: { post: defaults.datasets_byDatasetId_metadata_builtIn_byAction_post },
            },
          },
        },
        apiKeys: {
          post: defaults.datasets_apiKeys_post,
          byApiKeyId: { delete: defaults.datasets_apiKeys_byApiKeyId_delete },
        },
      },
      snippets: {
        bySnippetId: {
          workflowRuns: {
            tasks: {
              byTaskId: {
                stop: { post: defaults.snippets_bySnippetId_workflowRuns_tasks_byTaskId_stop_post },
              },
            },
          },
          workflows: {
            byWorkflowId: {
              patch: defaults.snippets_bySnippetId_workflows_byWorkflowId_patch,
              delete: defaults.snippets_bySnippetId_workflows_byWorkflowId_delete,
            },
            draft: {
              nodes: {
                byNodeId: {
                  agentComposer: {
                    put: defaults.snippets_bySnippetId_workflows_draft_nodes_byNodeId_agentComposer_put,
                    copyFromRoster: {
                      post: defaults.snippets_bySnippetId_workflows_draft_nodes_byNodeId_agentComposer_copyFromRoster_post,
                    },
                    saveToRoster: {
                      post: defaults.snippets_bySnippetId_workflows_draft_nodes_byNodeId_agentComposer_saveToRoster_post,
                    },
                  },
                },
              },
            },
          },
        },
      },
      installedApps: {
        byInstalledAppId: {
          get: defaults.installedApps_byInstalledAppId_get,
          patch: defaults.installedApps_byInstalledAppId_patch,
        },
      },
      agent: {
        post: defaults.agent_post,
        byAgentId: {
          trace: { post: defaults.agent_byAgentId_trace_post },
          traceConfig: {
            post: defaults.agent_byAgentId_traceConfig_post,
            patch: defaults.agent_byAgentId_traceConfig_patch,
            delete: defaults.agent_byAgentId_traceConfig_delete,
          },
          apiKeys: {
            post: defaults.agent_byAgentId_apiKeys_post,
            byApiKeyId: { delete: defaults.agent_byAgentId_apiKeys_byApiKeyId_delete },
          },
          get: defaults.agent_byAgentId_get,
          copy: { post: defaults.agent_byAgentId_copy_post },
          put: defaults.agent_byAgentId_put,
          composer: { put: defaults.agent_byAgentId_composer_put },
          publish: { post: defaults.agent_byAgentId_publish_post },
          delete: defaults.agent_byAgentId_delete,
        },
      },
      apiBasedExtension: {
        post: defaults.apiBasedExtension_post,
        byId: {
          post: defaults.apiBasedExtension_byId_post,
          delete: defaults.apiBasedExtension_byId_delete,
        },
      },
      resourceAccessTokens: {
        post: defaults.resourceAccessTokens_post,
        byTokenId: {
          patch: defaults.resourceAccessTokens_byTokenId_patch,
          relations: {
            byRelationId: {
              delete: defaults.resourceAccessTokens_byTokenId_relations_byRelationId_delete,
            },
          },
        },
      },
      tags: {
        post: defaults.tags_post,
        byTagId: { patch: defaults.tags_byTagId_patch, delete: defaults.tags_byTagId_delete },
      },
      enterprise: {
        appDeploy: {
          accessService: {
            updateEnvironmentApi: defaults.enterprise_appDeploy_accessService_updateEnvironmentApi,
            updateEnvironmentSite:
              defaults.enterprise_appDeploy_accessService_updateEnvironmentSite,
            createEnvironmentApiKey:
              defaults.enterprise_appDeploy_accessService_createEnvironmentApiKey,
            deleteEnvironmentApiKey:
              defaults.enterprise_appDeploy_accessService_deleteEnvironmentApiKey,
          },
          deploymentService: {
            deployWorkflow: defaults.enterprise_appDeploy_deploymentService_deployWorkflow,
            undeployWorkflow: defaults.enterprise_appDeploy_deploymentService_undeployWorkflow,
          },
        },
        webAppAuth: {
          updateWebAppWhitelistSubjects:
            defaults.enterprise_webAppAuth_updateWebAppWhitelistSubjects,
        },
      },
    },
  })
}
