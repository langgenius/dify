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
                // Waits for the pending invitations; members and seats refresh in the background.
                onSettled: (_data, _error, { params }, _result, { client }) => {
                  void invalidateQueryKeys(client, [
                    consoleQuery.workspaces.current.members.get.key(),
                    consoleQuery.features.get.queryKey(),
                  ])
                  return invalidateQueryKeys(client, [
                    consoleQuery.workspaces.byWorkspaceId.members.pendingInvitations.get.key({
                      input: { params: { workspace_id: params.workspace_id } },
                    }),
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
            // Waits for the snippet list and details; workflows refresh in the background.
            onSuccess: (_data, _variables, _onMutateResult, context) => {
              void context.client.invalidateQueries({
                queryKey: consoleQuery.snippets.key(),
              })
              return context.client.invalidateQueries({
                queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
              })
            },
          },
        },
        bySnippetId: {
          patch: {
            mutationOptions: {
              // Waits for the snippet list and details; workflows refresh in the background.
              onSuccess: (_data, _variables, _onMutateResult, context) => {
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.snippets.key(),
                })
                return context.client.invalidateQueries({
                  queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
                })
              },
            },
          },
          delete: {
            mutationOptions: {
              // Waits for the snippet list and details; workflows refresh in the background.
              onSuccess: (_data, _variables, _onMutateResult, context) => {
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.snippets.key(),
                })
                return context.client.invalidateQueries({
                  queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
                })
              },
            },
          },
          useCount: {
            increment: {
              post: {
                mutationOptions: {
                  // Waits for the snippet list and details; workflows refresh in the background.
                  onSuccess: (_data, _variables, _onMutateResult, context) => {
                    void context.client.invalidateQueries({
                      queryKey: consoleQuery.snippets.key(),
                    })
                    return context.client.invalidateQueries({
                      queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
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
              // Waits for the snippet list and details; workflows refresh in the background.
              onSuccess: (_data, _variables, _onMutateResult, context) => {
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.snippets.key(),
                })
                return context.client.invalidateQueries({
                  queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
                })
              },
            },
          },
          byImportId: {
            confirm: {
              post: {
                mutationOptions: {
                  // Waits for the snippet list and details; workflows refresh in the background.
                  onSuccess: (_data, _variables, _onMutateResult, context) => {
                    void context.client.invalidateQueries({
                      queryKey: consoleQuery.snippets.key(),
                    })
                    return context.client.invalidateQueries({
                      queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
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
        // Waits for the member list and pending invitations; seats refresh in the background.
        inviteEmail: {
          post: {
            mutationOptions: {
              // The invite modal shows the one-time invitation links from the response, and
              // the response has no member rows to write. A new invitee can't be acted on
              // before its row appears, so the lists refresh in the background.
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
              // Waits for the groups list and details; app bindings refresh in the background.
              onSettled: (_data, error, _variables, _result, { client }) => {
                if (error) return
                const groups = consoleQuery.workspaces.current.networkAccessGroups
                void invalidateQueryKeys(client, [
                  consoleQuery.apps.byAppId.networkAccessGroup.key(),
                ])
                return invalidateQueryKeys(client, [groups.get.key(), groups.byGroupId.key()])
              },
            },
          },
          delete: {
            mutationOptions: {
              // Waits for the groups list; details and app bindings refresh in the background.
              onSettled: (_data, error, _variables, _result, { client }) => {
                if (error) return
                const groups = consoleQuery.workspaces.current.networkAccessGroups
                void invalidateQueryKeys(client, [
                  groups.byGroupId.key(),
                  consoleQuery.apps.byAppId.networkAccessGroup.key(),
                ])
                return invalidateQueryKeys(client, [groups.get.key()])
              },
            },
          },
        },
      },
      // Role writes refresh the role list; role assignment changes also refresh members.
      rbac: {
        roles: {
          // `RoleModal` seeds its draft from this list when it reopens, so saves wait
          // for it; otherwise a quick reopen saves the old permissions back.
          post: {
            mutationOptions: {
              onSettled: (_data, error, _variables, _result, { client }) => {
                if (error) return
                return invalidateQueryKeys(client, [
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
                  return invalidateQueryKeys(client, [
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
                  // Waits for the role list the copy appears in; members refresh in the background.
                  onSettled: (_data, error, variables, _result, { client }) => {
                    if (error) return
                    if (variables.body?.copy_member)
                      void invalidateQueryKeys(client, [
                        consoleQuery.workspaces.current.members.get.key(),
                      ])
                    return invalidateQueryKeys(client, [
                      consoleQuery.workspaces.current.rbac.roles.get.key(),
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
                    // `AssignRolesContent` seeds its draft from the member's roles when it
                    // reopens, so the save waits for both reloads.
                    return invalidateQueryKeys(client, [
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
        // Every permission-set write waits for the RBAC lists it changes (the modal seeds its
        // draft from them); resource details refresh in the background.
        accessPolicies: {
          post: {
            mutationOptions: {
              onSettled: (_data, error, _variables, _result, context) => {
                if (error) return
                return invalidateAccessPolicyQueries(consoleQuery, context.client)
              },
            },
          },
          byPolicyId: {
            put: {
              mutationOptions: {
                onSettled: (_data, error, _variables, _result, context) => {
                  if (error) return
                  return invalidateAccessPolicyQueries(consoleQuery, context.client)
                },
              },
            },
            delete: {
              mutationOptions: {
                onSettled: (_data, error, _variables, _result, context) => {
                  if (error) return
                  return invalidateAccessPolicyQueries(consoleQuery, context.client)
                },
              },
            },
            copy: {
              post: {
                mutationOptions: {
                  onSettled: (_data, error, _variables, _result, context) => {
                    if (error) return
                    return invalidateAccessPolicyQueries(consoleQuery, context.client)
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

/** Returns once the RBAC lists have refreshed; resource details refresh in the background. */
function invalidateAccessPolicyQueries(query: RouterUtils<ConsoleClient>, client: QueryClient) {
  void invalidateQueryKeys(client, [
    query.agent.get.key(),
    query.agent.byAgentId.get.key(),
    query.apps.byAppId.get.key(),
    query.datasets.byDatasetId.get.key(),
  ])
  return invalidateQueryKeys(client, [query.workspaces.current.rbac.key()])
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
