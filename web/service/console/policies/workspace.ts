import type {
  AccountWithRoleListResponse,
  RbacRoleList,
  WorkspaceAccessMatrix,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { RouterUtils } from '@orpc/tanstack-query'
import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { ConsoleClient } from '../index'
import type { ConsolePolicies, ConsoleQuery } from './types'
import { humanInputPolicies } from './human-input'
import { workspacePluginPolicies } from './plugins'
import { invalidateQueryKeys } from './shared'
import { skillPolicies } from './skills'

// Resources whose details show the permission sets they are bound to.
const accessPolicyReaders = [
  'agent.get',
  'agent.byAgentId.get',
  'apps.byAppId.get',
  'datasets.byDatasetId.get',
]
// An agent's access changes the agent lists and who can be invited to it.
const agentAccessReaders = ['agent.get', 'agent.inviteOptions', 'agent.byAgentId.get']
const appNetworkAccessGroupPath = 'apps.byAppId.networkAccessGroup'
const humanInputContactPaths = [
  'workspaces.current.humanInput.v2.contacts',
  'workspaces.current.humanInput.v2.contactOptions',
  'workspaces.current.humanInput.v2.imIdentities',
  'workspaces.current.humanInput.v2.organizationCandidates',
]

export function workspacePolicies(consoleQuery: ConsoleQuery): ConsolePolicies['workspaces'] {
  return {
    byWorkspaceId: {
      members: {
        pendingInvitations: {
          revoke: {
            post: {
              mutationOptions: {
                // Invitees are listed as members too, and invitations use seats.
                meta: { alsoInvalidate: ['features', 'workspaces.current.members'] },
                // A failed revoke may mean the invitation was already accepted or revoked, so
                // members and seats refresh after one too. Waits for the pending invitations.
                onSettled: (_data, error, { params }, _result, { client }) => {
                  if (error)
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
            meta: { alsoInvalidate: ['snippets'] },
            // Waits for the snippet list and details.
            onSuccess: (_data, _variables, _onMutateResult, context) =>
              context.client.invalidateQueries({
                queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
              }),
          },
        },
        bySnippetId: {
          patch: {
            mutationOptions: {
              meta: { alsoInvalidate: ['snippets'] },
              // Waits for the snippet list and details.
              onSuccess: (_data, _variables, _onMutateResult, context) =>
                context.client.invalidateQueries({
                  queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
                }),
            },
          },
          delete: {
            mutationOptions: {
              meta: { alsoInvalidate: ['snippets'] },
              // Waits for the snippet list and details.
              onSuccess: (_data, _variables, _onMutateResult, context) =>
                context.client.invalidateQueries({
                  queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
                }),
            },
          },
          useCount: {
            increment: {
              post: {
                mutationOptions: {
                  meta: { alsoInvalidate: ['snippets'] },
                  // Waits for the snippet list and details.
                  onSuccess: (_data, _variables, _onMutateResult, context) =>
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
                    }),
                },
              },
            },
          },
        },
        imports: {
          post: {
            mutationOptions: {
              meta: { alsoInvalidate: ['snippets'] },
              // Waits for the snippet list and details.
              onSuccess: (_data, _variables, _onMutateResult, context) =>
                context.client.invalidateQueries({
                  queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
                }),
            },
          },
          byImportId: {
            confirm: {
              post: {
                mutationOptions: {
                  meta: { alsoInvalidate: ['snippets'] },
                  // Waits for the snippet list and details.
                  onSuccess: (_data, _variables, _onMutateResult, context) =>
                    context.client.invalidateQueries({
                      queryKey: consoleQuery.workspaces.current.customizedSnippets.key(),
                    }),
                },
              },
            },
          },
        },
      },
      members: {
        inviteEmail: {
          post: {
            mutationOptions: {
              // Invitations change seats (plan usage) and pending invitations. The invite modal
              // shows the one-time links from the response, so nothing waits for the lists.
              meta: {
                alsoInvalidate: ['features', 'workspaces.byWorkspaceId.members.pendingInvitations'],
              },
            },
          },
        },
        byMemberId: {
          delete: {
            mutationOptions: {
              // Contacts list workspace members.
              meta: { alsoInvalidate: humanInputContactPaths },
              // The row leaves at once; the refetch confirms it.
              onSuccess: async (_data, variables, _result, context) => {
                if (
                  context.client.isFetching({
                    queryKey: consoleQuery.workspaces.current.members.get.key(),
                  })
                )
                  await context.client.cancelQueries({
                    queryKey: consoleQuery.workspaces.current.members.get.key(),
                  })
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
              },
            },
          },
        },
      },
      networkAccessGroups: {
        post: {
          mutationOptions: {
            meta: { alsoInvalidate: [appNetworkAccessGroupPath] },
            // Show the new group right away; the settled refetch confirms it.
            onSuccess: async (data, _variables, _result, { client }) => {
              const queryKey = consoleQuery.workspaces.current.networkAccessGroups.get.queryKey()
              if (client.isFetching({ queryKey, exact: true }))
                await client.cancelQueries({ queryKey, exact: true })
              client.setQueryData(queryKey, (current) => {
                if (!current) return current
                if (current.groups.some((group) => group.id === data.group.id)) return current
                return { ...current, groups: [...current.groups, data.group] }
              })
            },
            onSettled: (_data, error, _variables, _result, { client }) => {
              if (error) return
              void invalidateQueryKeys(client, [
                consoleQuery.workspaces.current.networkAccessGroups.get.key(),
              ])
            },
          },
        },
        byGroupId: {
          put: {
            mutationOptions: {
              meta: { alsoInvalidate: [appNetworkAccessGroupPath] },
              // Waits for the groups list and details.
              onSettled: (_data, error, _variables, _result, { client }) => {
                if (error) return
                const groups = consoleQuery.workspaces.current.networkAccessGroups
                return invalidateQueryKeys(client, [groups.get.key(), groups.byGroupId.key()])
              },
            },
          },
          delete: {
            mutationOptions: {
              meta: { alsoInvalidate: [appNetworkAccessGroupPath] },
              // Waits for the groups list.
              onSettled: (_data, error, _variables, _result, { client }) => {
                if (error) return
                return invalidateQueryKeys(client, [
                  consoleQuery.workspaces.current.networkAccessGroups.get.key(),
                ])
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
                // Removing a role changes the roles shown on member rows.
                meta: { alsoInvalidate: ['workspaces.current.members'] },
                // The role leaves at once; the refetch confirms it.
                onSettled: async (_data, error, { params }, _result, { client }) => {
                  if (error) return
                  const roles = consoleQuery.workspaces.current.rbac.roles.get
                  const removeRole = (page: RbacRoleList): RbacRoleList =>
                    page.data?.some((role) => role.id === params.role_id)
                      ? {
                          ...page,
                          data: page.data.filter((role) => role.id !== params.role_id),
                        }
                      : page
                  if (
                    client.isFetching({ queryKey: roles.key({ type: 'query' }) }) ||
                    client.isFetching({ queryKey: roles.key({ type: 'infinite' }) })
                  )
                    await Promise.all([
                      client.cancelQueries({ queryKey: roles.key({ type: 'query' }) }),
                      client.cancelQueries({ queryKey: roles.key({ type: 'infinite' }) }),
                    ])
                  client.setQueriesData<RbacRoleList>(
                    { queryKey: roles.key({ type: 'query' }) },
                    (data) => data && removeRole(data),
                  )
                  client.setQueriesData<InfiniteData<RbacRoleList>>(
                    { queryKey: roles.key({ type: 'infinite' }) },
                    (data) => data && { ...data, pages: data.pages.map(removeRole) },
                  )
                  void client.invalidateQueries({ queryKey: roles.key() })
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
        // draft from them).
        accessPolicies: {
          post: {
            mutationOptions: {
              meta: { alsoInvalidate: accessPolicyReaders },
              onSettled: (_data, error, _variables, _result, context) => {
                if (error) return
                return invalidateAccessPolicyQueries(consoleQuery, context.client)
              },
            },
          },
          byPolicyId: {
            put: {
              mutationOptions: {
                meta: { alsoInvalidate: accessPolicyReaders },
                onSettled: (_data, error, _variables, _result, context) => {
                  if (error) return
                  return invalidateAccessPolicyQueries(consoleQuery, context.client)
                },
              },
            },
            delete: {
              mutationOptions: {
                meta: { alsoInvalidate: accessPolicyReaders },
                // The rule leaves its list before the delete dialog closes, so focus does not
                // return to its row.
                onSuccess: (_data, { params }, _result, { client }) =>
                  removeAccessPolicyRows(consoleQuery, client, params.policy_id),
                onSettled: (_data, error, _variables, _result, context) => {
                  if (error) return
                  return invalidateAccessPolicyQueries(consoleQuery, context.client)
                },
              },
            },
            copy: {
              post: {
                mutationOptions: {
                  meta: { alsoInvalidate: accessPolicyReaders },
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
                  meta: { alsoInvalidate: agentAccessReaders },
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
                      meta: { alsoInvalidate: agentAccessReaders },
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
                      meta: { alsoInvalidate: agentAccessReaders },
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
  return invalidateQueryKeys(client, [query.workspaces.current.rbac.key()])
}

async function removeAccessPolicyRows(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
  policyId: string,
) {
  const lists = query.workspaces.current.rbac.workspace
  // Every page carries the list's total, and the section shows the first page's; once the rule
  // is found on any page, the row leaves its page and every page's total drops.
  const removeRule = (data: InfiniteData<WorkspaceAccessMatrix>) => {
    if (!data.pages.some((page) => page.items?.some((row) => row.policy?.id === policyId)))
      return data
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items?.filter((row) => row.policy?.id !== policyId),
        pagination: page.pagination && {
          ...page.pagination,
          total_count: Math.max(0, (page.pagination.total_count ?? 0) - 1),
        },
      })),
    }
  }
  const listKeys = [lists.apps, lists.datasets, lists.agents].map((list) =>
    list.accessPolicy.get.key({ type: 'infinite' }),
  )
  // Cancel only running reads: an await with nothing to cancel would move the write past the
  // delete dialog's own callback.
  const running = listKeys.filter((queryKey) => client.isFetching({ queryKey }))
  if (running.length)
    await Promise.all(running.map((queryKey) => client.cancelQueries({ queryKey })))
  for (const queryKey of listKeys)
    client.setQueriesData<InfiniteData<WorkspaceAccessMatrix>>(
      { queryKey },
      (data) => data && removeRule(data),
    )
}

// Returns once the agent's access settings have refreshed.
function invalidateAgentAccessQueries(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
  agentId: string,
) {
  return invalidateQueryKeys(client, [
    query.workspaces.current.rbac.agents.byAgentId.key({
      input: { params: { agent_id: agentId } },
    }),
  ])
}
