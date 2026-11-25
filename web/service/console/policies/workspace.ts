import type {
  AccountWithRoleListResponse,
  RbacRoleList,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { RouterUtils } from '@orpc/tanstack-query'
import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { ConsoleClient } from '../index'
import type { ConsolePolicies, ConsoleQuery } from './types'
import { humanInputPolicies } from './human-input'
import { workspacePluginPolicies } from './plugins'
import {
  invalidateHumanInputContactQueries,
  invalidateNetworkAccessGroupQueries,
  invalidateQueryKeys,
} from './shared'
import { skillPolicies } from './skills'

export function workspacePolicies(consoleQuery: ConsoleQuery): ConsolePolicies['workspaces'] {
  return {
    byWorkspaceId: {
      members: {
        pendingInvitations: {
          revoke: {
            post: {
              mutationOptions: {
                // A failed revoke may mean the invitation was already accepted or revoked.
                onSettled: (_data, _error, { params }, _result, { client }) => {
                  void invalidateQueryKeys(client, [
                    consoleQuery.workspaces.current.members.get.key(),
                    consoleQuery.workspaces.byWorkspaceId.members.pendingInvitations.get.key({
                      input: { params: { workspace_id: params.workspace_id } },
                    }),
                    consoleQuery.features.get.queryKey(),
                  ])
                },
              },
            },
          },
        },
      },
    },
    current: {
      customizedSnippets: {
        post: {
          mutationOptions: {
            onSuccess: (_data, _variables, _onMutateResult, context) => {
              void context.client.invalidateQueries({
                queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
              })
              void context.client.invalidateQueries({
                queryKey: consoleQuery.snippets.key(),
              })
            },
          },
        },
        bySnippetId: {
          patch: {
            mutationOptions: {
              onSuccess: (_data, _variables, _onMutateResult, context) => {
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
                })
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.snippets.key(),
                })
              },
            },
          },
          delete: {
            mutationOptions: {
              onSuccess: (_data, _variables, _onMutateResult, context) => {
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
                })
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.snippets.key(),
                })
              },
            },
          },
          useCount: {
            increment: {
              post: {
                mutationOptions: {
                  onSuccess: (_data, _variables, _onMutateResult, context) => {
                    void context.client.invalidateQueries({
                      queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
                    })
                    void context.client.invalidateQueries({
                      queryKey: consoleQuery.snippets.key(),
                    })
                  },
                },
              },
            },
          },
        },
        imports: {
          post: {
            mutationOptions: {
              onSuccess: (_data, _variables, _onMutateResult, context) => {
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
                })
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.snippets.key(),
                })
              },
            },
          },
          byImportId: {
            confirm: {
              post: {
                mutationOptions: {
                  onSuccess: (_data, _variables, _onMutateResult, context) => {
                    void context.client.invalidateQueries({
                      queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
                    })
                    void context.client.invalidateQueries({
                      queryKey: consoleQuery.snippets.key(),
                    })
                  },
                },
              },
            },
          },
        },
      },
      members: {
        // Invitations change seats (plan usage), the member list, and pending invitations.
        inviteEmail: {
          post: {
            mutationOptions: {
              onSuccess: (response, _variables, _result, { client }) => {
                void invalidateQueryKeys(client, [
                  consoleQuery.features.get.queryKey(),
                  consoleQuery.workspaces.current.members.get.key(),
                  consoleQuery.workspaces.byWorkspaceId.members.pendingInvitations.get.key({
                    input: { params: { workspace_id: response.tenant_id } },
                  }),
                ])
              },
            },
          },
        },
        byMemberId: {
          delete: {
            mutationOptions: {
              onSuccess: (_data, variables, _result, context) => {
                context.client.setQueriesData(
                  { queryKey: consoleQuery.workspaces.current.members.get.key() },
                  (members: AccountWithRoleListResponse | undefined) =>
                    members && {
                      ...members,
                      accounts: members.accounts.filter(
                        (member) => member.id !== variables.params.member_id,
                      ),
                    },
                )
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.workspaces.current.members.get.key(),
                })
                void invalidateHumanInputContactQueries(consoleQuery, context.client)
              },
            },
          },
        },
      },
      networkAccessGroups: {
        post: {
          mutationOptions: {
            // Show the new group right away; the settled refetch confirms it.
            onSuccess: (data, _variables, _result, { client }) => {
              client.setQueryData(
                consoleQuery.workspaces.current.networkAccessGroups.get.queryKey(),
                (current) => {
                  if (!current) return current
                  if (current.groups.some((group) => group.id === data.group.id)) return current
                  return { ...current, groups: [...current.groups, data.group] }
                },
              )
            },
            onSettled: (_data, error, _variables, _result, context) => {
              if (error) return
              void invalidateNetworkAccessGroupQueries(consoleQuery, context.client)
            },
          },
        },
        byGroupId: {
          put: {
            mutationOptions: {
              onSettled: (_data, error, _variables, _result, context) => {
                if (error) return
                void invalidateNetworkAccessGroupQueries(consoleQuery, context.client)
              },
            },
          },
          delete: {
            mutationOptions: {
              onSettled: (_data, error, _variables, _result, context) => {
                if (error) return
                void invalidateNetworkAccessGroupQueries(consoleQuery, context.client)
              },
            },
          },
        },
      },
      // Role writes refresh the role list; role assignment changes also refresh members.
      rbac: {
        roles: {
          post: {
            mutationOptions: {
              onSettled: (_data, error, _variables, _result, { client }) => {
                if (error) return
                void invalidateQueryKeys(client, [
                  consoleQuery.workspaces.current.rbac.roles.get.key(),
                ])
              },
            },
          },
          byRoleId: {
            put: {
              mutationOptions: {
                onSettled: (_data, error, _variables, _result, { client }) => {
                  if (error) return
                  void invalidateQueryKeys(client, [
                    consoleQuery.workspaces.current.rbac.roles.get.key(),
                  ])
                },
              },
            },
            delete: {
              mutationOptions: {
                onSettled: (_data, error, { params }, _result, { client }) => {
                  if (error) return
                  const roles = consoleQuery.workspaces.current.rbac.roles.get
                  const removeRole = (page: RbacRoleList): RbacRoleList =>
                    page.data?.some((role) => role.id === params.role_id)
                      ? {
                          ...page,
                          data: page.data.filter((role) => role.id !== params.role_id),
                        }
                      : page
                  client.setQueriesData<RbacRoleList>(
                    { queryKey: roles.key({ type: 'query' }) },
                    (data) => data && removeRole(data),
                  )
                  client.setQueriesData<InfiniteData<RbacRoleList>>(
                    { queryKey: roles.key({ type: 'infinite' }) },
                    (data) => data && { ...data, pages: data.pages.map(removeRole) },
                  )
                  void client.invalidateQueries({ queryKey: roles.key() })
                  void client.invalidateQueries({
                    queryKey: consoleQuery.workspaces.current.members.get.key(),
                  })
                },
              },
            },
            copy: {
              post: {
                mutationOptions: {
                  onSettled: (_data, error, variables, _result, { client }) => {
                    if (error) return
                    void invalidateQueryKeys(client, [
                      consoleQuery.workspaces.current.rbac.roles.get.key(),
                      ...(variables.body?.copy_member
                        ? [consoleQuery.workspaces.current.members.get.key()]
                        : []),
                    ])
                  },
                },
              },
            },
          },
        },
        members: {
          byMemberId: {
            rbacRoles: {
              put: {
                mutationOptions: {
                  onSettled: (_data, error, variables, _result, { client }) => {
                    if (error) return
                    void invalidateQueryKeys(client, [
                      consoleQuery.workspaces.current.rbac.members.byMemberId.rbacRoles.get.key({
                        input: { params: variables.params },
                      }),
                      consoleQuery.workspaces.current.members.get.key(),
                    ])
                  },
                },
              },
            },
          },
        },
        accessPolicies: {
          post: {
            mutationOptions: {
              onSettled: (_data, error, _variables, _result, context) => {
                if (error) return
                void invalidateAccessPolicyQueries(consoleQuery, context.client)
              },
            },
          },
          byPolicyId: {
            put: {
              mutationOptions: {
                onSettled: (_data, error, _variables, _result, context) => {
                  if (error) return
                  void invalidateAccessPolicyQueries(consoleQuery, context.client)
                },
              },
            },
            delete: {
              mutationOptions: {
                onSettled: (_data, error, _variables, _result, context) => {
                  if (error) return
                  void invalidateAccessPolicyQueries(consoleQuery, context.client)
                },
              },
            },
            copy: {
              post: {
                mutationOptions: {
                  onSettled: (_data, error, _variables, _result, context) => {
                    if (error) return
                    void invalidateAccessPolicyQueries(consoleQuery, context.client)
                  },
                },
              },
            },
          },
        },
        agents: {
          byAgentId: {
            whitelist: {
              put: {
                mutationOptions: {
                  onSettled: (_data, error, variables, _result, context) => {
                    if (error) return
                    // The access page shows the pending scope toggle until the refreshed config lands.
                    return invalidateAgentAccessQueries(
                      consoleQuery,
                      context.client,
                      variables.params.agent_id,
                    )
                  },
                },
              },
            },
            users: {
              byTargetAccountId: {
                accessPolicies: {
                  put: {
                    mutationOptions: {
                      onSettled: (_data, error, variables, _result, context) => {
                        if (error) return
                        // The access page keeps the member row and add menu busy until the refreshed list lands.
                        return invalidateAgentAccessQueries(
                          consoleQuery,
                          context.client,
                          variables.params.agent_id,
                        )
                      },
                    },
                  },
                },
              },
            },
            accessPolicies: {
              byPolicyId: {
                memberBindings: {
                  delete: {
                    mutationOptions: {
                      onSettled: (_data, error, variables, _result, context) => {
                        if (error) return
                        // The access page keeps removed rows busy until the refreshed list lands.
                        return invalidateAgentAccessQueries(
                          consoleQuery,
                          context.client,
                          variables.params.agent_id,
                        )
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      ...workspacePluginPolicies(consoleQuery),
      ...humanInputPolicies(consoleQuery),
      ...skillPolicies(consoleQuery),
    },
    customConfig: {
      post: {
        mutationOptions: {
          // The web app brand switch and logo read the refreshed config once the save resolves.
          onSuccess: (_data, _variables, _result, { client }) =>
            client.invalidateQueries({
              queryKey: consoleQuery.workspaces.customConfig.get.key(),
            }),
        },
      },
    },
  }
}

function invalidateAccessPolicyQueries(query: RouterUtils<ConsoleClient>, client: QueryClient) {
  return invalidateQueryKeys(client, [
    query.workspaces.current.rbac.key(),
    query.agent.get.key(),
    query.agent.byAgentId.get.key(),
    query.apps.byAppId.get.key(),
    query.datasets.byDatasetId.get.key(),
  ])
}

// Returns once the agent's access settings have refreshed; permissions and agent
// lists refresh in the background.
function invalidateAgentAccessQueries(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
  agentId: string,
) {
  void invalidateQueryKeys(client, [
    query.workspaces.current.rbac.myPermissions.get.key(),
    query.agent.get.key(),
    query.agent.inviteOptions.get.key(),
    query.agent.byAgentId.get.queryKey({ input: { params: { agent_id: agentId } } }),
  ])
  return invalidateQueryKeys(client, [
    query.workspaces.current.rbac.agents.byAgentId.key({
      input: { params: { agent_id: agentId } },
    }),
  ])
}
